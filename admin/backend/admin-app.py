"""
Admin backend for the Lost & Found system (separate from app.py).

Run:      python admin-app.py      -> http://127.0.0.1:5001
Install:  pip install -r requirements.txt

.env needs:
    SUPABASE_URL=...
    SUPABASE_SERVICE_KEY=...        (service_role key, NEVER put this in HTML)
    ADMIN_EMAILS=admin@school.edu   (comma-separated; required for admin authorization)
    FRONTEND_URL=https://your-admin.netlify.app,http://127.0.0.1:5500
"""
import os
import math
import time
import io
import csv
import json
import re
from datetime import datetime, timezone
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
app = Flask(__name__)

# ---- CORS ----
# Automatically permits all localhost/127.0.0.1 ports and Netlify domains, plus any custom FRONTEND_URL
allowed_origins = [
    r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    r"^https://.*\.netlify\.app$",
]

for url in os.environ.get("FRONTEND_URL", "").split(","):
    u = url.strip().rstrip("/")
    if u and u not in allowed_origins:
        allowed_origins.append(u)

CORS(
    app,
    resources={r"/*": {"origins": allowed_origins}},
    supports_credentials=True,
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"],
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
)


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin")
    if origin and (
        re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origin)
        or re.match(r"^https://.*\.netlify\.app$", origin)
        or origin in allowed_origins
    ):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = (
            "Authorization, Content-Type, Accept, Origin, X-Requested-With"
        )
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response

# ---- Supabase (service key: bypasses RLS, so we check admin ourselves) ----
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("ADMIN_EMAILS", "").split(",")
    if e.strip()
}
if not ADMIN_EMAILS:
    print("WARNING: ADMIN_EMAILS is empty in env. Will rely on database admins table.")

# kind -> (table, filters). Keys match the data-stat names in the dashboard.
LISTS = {
    "missing_items": ("lost_items", {}),
    "found_items": ("found_items", {}),
    "match_items": ("match_items", {}),
    "claimed": ("match_items", {"status": "claimed"}),
}

SENSITIVE_KEYS = {"password", "token", "access_token", "refresh_token", "service_key", "secret", "api_key"}

# In-memory rate limiting for unauthenticated failed-login logging (IP -> [timestamps])
FAILED_LOGIN_ATTEMPTS = {}
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX_ATTEMPTS = 15


def sanitize_json_values(val):
    """Recursively removes sensitive keys from audit log JSON values."""
    if not val:
        return None
    if isinstance(val, dict):
        cleaned = {}
        for k, v in val.items():
            if any(s in str(k).lower() for s in SENSITIVE_KEYS):
                cleaned[k] = "[REDACTED]"
            elif isinstance(v, (dict, list)):
                cleaned[k] = sanitize_json_values(v)
            else:
                cleaned[k] = v
        return cleaned
    elif isinstance(val, list):
        return [sanitize_json_values(item) for item in val]
    return val


def get_request_ip():
    """Extracts the client IP address, handling proxy headers safely."""
    if not request:
        return None
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or ""


def get_request_user_agent():
    """Extracts and truncates the request User-Agent header."""
    if not request:
        return None
    return (request.headers.get("User-Agent", "") or "")[:500]


def is_rate_limited(ip_address):
    """Checks whether an IP has exceeded failed login logging limits."""
    now = time.time()
    history = FAILED_LOGIN_ATTEMPTS.get(ip_address, [])
    # Keep only timestamps within window
    history = [t for t in history if now - t < RATE_LIMIT_WINDOW]
    if len(history) >= RATE_LIMIT_MAX_ATTEMPTS:
        FAILED_LOGIN_ATTEMPTS[ip_address] = history
        return True
    history.append(now)
    FAILED_LOGIN_ATTEMPTS[ip_address] = history
    return False


def is_admin_user(user):
    """
    Checks whether a user has administrative authorization.
    Verifies against the ADMIN_EMAILS allowlist and the admins database table.
    """
    if not user:
        return False

    user_email = (user.email or "").strip().lower()

    # 1. Check ADMIN_EMAILS env allowlist if provided
    if ADMIN_EMAILS and user_email in ADMIN_EMAILS:
        return True

    # 2. Check the Supabase admins table
    try:
        if getattr(user, "id", None):
            res_id = sb.table("admins").select("id").eq("user_id", user.id).limit(1).execute()
            if res_id.data and len(res_id.data) > 0:
                return True

        if user_email:
            res_email = sb.table("admins").select("id").eq("email", user_email).limit(1).execute()
            if res_email.data and len(res_email.data) > 0:
                return True
    except Exception as e:
        print("admins table lookup error:", e)

    return False


def require_admin():
    """Validates Supabase JWT and ensures the authenticated user is an authorized admin."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "").strip()
    if not token:
        return None

    try:
        user = sb.auth.get_user(token).user
    except Exception:
        return None

    if not user or not is_admin_user(user):
        return None

    return user


def log_admin_action(
    action: str,
    module: str,
    description: str,
    user=None,
    target_id: str = None,
    old_values: dict = None,
    new_values: dict = None,
    ip_address: str = None,
    user_agent: str = None,
    admin_id: str = None,
    admin_email: str = None,
):
    """
    Inserts an immutable record into admin_audit_logs using the backend service client.
    Derives admin identity from the verified user object when provided.
    Never raises an uncaught exception into the caller.
    """
    resolved_id = None
    resolved_email = None

    if user:
        resolved_id = getattr(user, "id", None) or (user.get("id") if isinstance(user, dict) else None)
        resolved_email = getattr(user, "email", None) or (user.get("email") if isinstance(user, dict) else None)
    else:
        resolved_id = admin_id
        resolved_email = admin_email

    client_ip = ip_address or get_request_ip()
    client_ua = user_agent or get_request_user_agent()

    log_entry = {
        "admin_id": str(resolved_id) if resolved_id else None,
        "admin_email": str(resolved_email).strip().lower() if resolved_email else "unknown",
        "action": str(action).strip().upper() if action else "UNKNOWN",
        "module": str(module).strip().upper() if module else "GENERAL",
        "description": str(description).strip() if description else "",
        "target_id": str(target_id) if target_id else None,
        "old_values": sanitize_json_values(old_values),
        "new_values": sanitize_json_values(new_values),
        "ip_address": client_ip,
        "user_agent": client_ua,
    }

    try:
        sb.table("admin_audit_logs").insert(log_entry).execute()
        return True
    except Exception as e:
        print(f"Failed to record audit log for action '{action}':", e)
        return False


def count(table, **eq):
    q = sb.table(table).select("id", count="exact")
    for k, v in eq.items():
        q = q.eq(k, v)
    return q.limit(1).execute().count or 0


@app.get("/")
def health():
    return "admin ok"


# ---- Summary cache (CAO: memory hierarchy / cache) ----
# The cache sits between the dashboard and the database (the slow "main memory").
# How long a cached copy stays valid, in seconds (change it in .env if you like):
CACHE_TTL_SECONDS = float(os.environ.get("CACHE_TTL_SECONDS", "30"))
_summary_cache = {"data": None, "stored_at": 0.0}
CACHE_STATS = {
    "hits": 0,
    "misses": 0,
    "hit_time_total": 0.0,   # seconds spent serving cache hits
    "miss_time_total": 0.0,  # seconds spent serving misses (trips to the database)
}
AUTH_STATS = {"count": 0, "total": 0.0}  # seconds spent checking the admin login


def fetch_summary_counts():
    """The slow path: 4 trips to the database."""
    return dict(
        missing_items=count("lost_items"),
        found_items=count("found_items"),
        match_items=count("match_items"),
        claimed=count("match_items", status="claimed"),
    )


def get_summary_cached():
    """Returns (summary_dict, was_hit). Counts hits/misses and times each path."""
    start = time.perf_counter()
    cached = _summary_cache["data"]
    fresh = (time.time() - _summary_cache["stored_at"]) < CACHE_TTL_SECONDS
    if cached is not None and fresh:
        data = dict(cached)
        CACHE_STATS["hits"] += 1
        CACHE_STATS["hit_time_total"] += time.perf_counter() - start
        return data, True

    data = fetch_summary_counts()
    _summary_cache["data"] = data
    _summary_cache["stored_at"] = time.time()
    CACHE_STATS["misses"] += 1
    CACHE_STATS["miss_time_total"] += time.perf_counter() - start
    return dict(data), False


def invalidate_summary_cache():
    """Called after a write so the dashboard never shows stale counts."""
    _summary_cache["data"] = None


@app.get("/admin/summary")
def admin_summary():
    auth_start = time.perf_counter()
    if not require_admin():
        return jsonify(error="Unauthorized"), 401
    AUTH_STATS["count"] += 1
    AUTH_STATS["total"] += time.perf_counter() - auth_start
    try:
        data, _ = get_summary_cached()
        return jsonify(data)
    except Exception as e:
        print("summary error:", e)
        return jsonify(error=str(e)), 500


@app.get("/admin/list/<kind>")
def admin_list(kind):
    if not require_admin():
        return jsonify(error="Unauthorized"), 401
    if kind not in LISTS:
        return jsonify(error="Unknown list"), 404
    table, filters = LISTS[kind]
    try:
        cols = "*, lost_items(*), found_items(*)" if table == "match_items" else "*"
        q = sb.table(table).select(cols).order("created_at", desc=True)
        for k, v in filters.items():
            q = q.eq(k, v)
        return jsonify(q.execute().data)
    except Exception as e:
        print("list error:", e)
        return jsonify(error=str(e)), 500


@app.post("/admin/claim/<match_id>")
def admin_mark_claimed(match_id):
    admin_user = require_admin()
    if not admin_user:
        return jsonify(error="Unauthorized"), 401
    try:
        m = (
            sb.table("match_items")
            .select("claim_item_id, found_item_id, status")
            .eq("id", match_id)
            .single()
            .execute()
            .data
        )
        if not m:
            return jsonify(error="Match not found"), 404

        old_status = m.get("status")
        old_values = {"match_status": old_status}

        sb.table("match_items").update({"status": "claimed"}).eq("id", match_id).execute()
        if m.get("found_item_id"):
            sb.table("found_items").update({"status": "claimed"}).eq("id", m["found_item_id"]).execute()
        if m.get("claim_item_id"):
            sb.table("lost_items").update({"status": "claimed"}).eq("id", m["claim_item_id"]).execute()

        new_values = {
            "match_status": "claimed",
            "found_item_status": "claimed",
            "lost_item_status": "claimed",
        }

        invalidate_summary_cache()  # NEW: counts changed, drop the cached copy

        # Automatically log the administrative action
        log_admin_action(
            action="APPROVE_CLAIM",
            module="CLAIMS",
            description=f"Admin approved claim for match {match_id}",
            user=admin_user,
            target_id=str(match_id),
            old_values=old_values,
            new_values=new_values,
        )

        return jsonify(ok=True)
    except Exception as e:
        print("admin claim error:", e)
        return jsonify(error=str(e)), 500


# =========================================================================
# AUTHENTICATION EVENT LOGGING ENDPOINTS
# =========================================================================

@app.post("/admin/audit/login")
def audit_login():
    """
    Records a successful admin login event.
    Protected: Must provide valid admin JWT. Identity is taken from token.
    """
    admin_user = require_admin()
    if not admin_user:
        return jsonify(error="Unauthorized"), 401

    log_admin_action(
        action="LOGIN",
        module="AUTH",
        description=f"Admin {admin_user.email} logged in successfully",
        user=admin_user,
    )
    return jsonify(ok=True)


@app.post("/admin/audit/logout")
def audit_logout():
    """
    Records an admin logout event.
    Protected: Must provide valid admin JWT before local token clearance.
    """
    admin_user = require_admin()
    if not admin_user:
        return jsonify(error="Unauthorized"), 401

    log_admin_action(
        action="LOGOUT",
        module="AUTH",
        description=f"Admin {admin_user.email} logged out",
        user=admin_user,
    )
    return jsonify(ok=True)


@app.post("/admin/audit/failed-login")
def audit_failed_login():
    """
    Records an unauthenticated failed login attempt.
    Rate-limited per IP, sanitized inputs, never logs passwords or tokens.
    """
    client_ip = get_request_ip()
    if is_rate_limited(client_ip):
        return jsonify(error="Too many requests"), 429

    payload = request.get_json(silent=True) or {}
    raw_email = str(payload.get("email") or "").strip().lower()
    raw_reason = str(payload.get("reason") or "Invalid credentials").strip()

    # Sanitize strings to avoid log injection / oversized payloads
    safe_email = "".join(c for c in raw_email if c.isalnum() or c in "@._-")[:100]
    safe_reason = "".join(c for c in raw_reason if c.isalnum() or c in " _-.:")[:100]

    if not safe_email:
        safe_email = "unknown"

    log_admin_action(
        action="FAILED_LOGIN",
        module="AUTH",
        description=f"Failed admin login attempt for '{safe_email}': {safe_reason}",
        admin_email=safe_email,
        ip_address=client_ip,
    )
    return jsonify(ok=True)


# =========================================================================
# AUDIT LOG ENDPOINTS (Protected)
# =========================================================================

def build_audit_query():
    """Constructs a filtered Supabase query based on request parameters."""
    query = sb.table("admin_audit_logs").select("*", count="exact")

    # 1. Search filter
    search = request.args.get("search", "").strip()
    if search:
        safe_search = "".join(c for c in search if c.isalnum() or c in " _-@.").strip()[:100]
        if safe_search:
            query = query.or_(
                f"description.ilike.%{safe_search}%,admin_email.ilike.%{safe_search}%,target_id.ilike.%{safe_search}%"
            )

    # 2. Administrator filter
    admin_email = request.args.get("admin_email", "").strip()
    if admin_email:
        query = query.ilike("admin_email", f"%{admin_email}%")

    # 3. Action filter
    action = request.args.get("action", "").strip()
    if action:
        query = query.eq("action", action.upper())

    # 4. Module filter
    module = request.args.get("module", "").strip()
    if module:
        query = query.eq("module", module.upper())

    # 5. Date range filters
    start_date = request.args.get("start_date", "").strip()
    if start_date:
        if len(start_date) == 10 and "T" not in start_date:
            start_date += "T00:00:00Z"
        query = query.gte("created_at", start_date)

    end_date = request.args.get("end_date", "").strip()
    if end_date:
        if len(end_date) == 10 and "T" not in end_date:
            end_date += "T23:59:59.999Z"
        query = query.lte("created_at", end_date)

    return query


@app.get("/admin/audit-logs")
def get_audit_logs():
    """
    Returns paginated, searchable, and filterable audit logs.
    Query parameters:
      - search: string (matches description, admin_email, or target_id)
      - admin_email: string
      - action: string
      - module: string
      - start_date: string (ISO or YYYY-MM-DD)
      - end_date: string (ISO or YYYY-MM-DD)
      - page: int (default 1)
      - limit: int (default 20, max 100)
    """
    admin_user = require_admin()
    if not admin_user:
        return jsonify(error="Unauthorized"), 401

    try:
        page = request.args.get("page", 1, type=int)
        if page < 1:
            page = 1

        limit = request.args.get("limit", 20, type=int)
        if limit < 1:
            limit = 20
        if limit > 100:
            limit = 100

        offset = (page - 1) * limit

        query = build_audit_query()
        query = query.order("created_at", desc=True).range(offset, offset + limit - 1)

        result = query.execute()
        total_count = result.count if result.count is not None else len(result.data)
        total_pages = math.ceil(total_count / limit) if total_count > 0 else 1

        return jsonify(
            logs=result.data,
            total=total_count,
            page=page,
            limit=limit,
            pages=total_pages,
        )
    except Exception as e:
        print("get_audit_logs error:", e)
        return jsonify(error=str(e)), 500


@app.get("/admin/audit-logs/filters")
def get_audit_log_filters():
    """
    Returns distinct options for populating frontend filter dropdowns:
    administrator emails, actions, and modules.
    """
    if not require_admin():
        return jsonify(error="Unauthorized"), 401

    try:
        standard_actions = {
            "LOGIN",
            "LOGOUT",
            "FAILED_LOGIN",
            "APPROVE_CLAIM",
            "CREATE_FOUND_ITEM",
            "EXPORT_LOGS",
        }
        standard_modules = {"AUTH", "CLAIMS", "ITEMS", "AUDIT", "REPORTS", "USERS"}

        res = (
            sb.table("admin_audit_logs")
            .select("admin_email, action, module")
            .order("created_at", desc=True)
            .limit(500)
            .execute()
        )

        admin_emails = set()
        recorded_actions = set(standard_actions)
        recorded_modules = set(standard_modules)

        for row in res.data or []:
            if row.get("admin_email"):
                admin_emails.add(row["admin_email"].strip().lower())
            if row.get("action"):
                recorded_actions.add(row["action"].strip().upper())
            if row.get("module"):
                recorded_modules.add(row["module"].strip().upper())

        try:
            admins_res = sb.table("admins").select("email").execute()
            for r in admins_res.data or []:
                if r.get("email"):
                    admin_emails.add(r["email"].strip().lower())
        except Exception:
            pass

        return jsonify(
            admin_emails=sorted(list(admin_emails)),
            actions=sorted(list(recorded_actions)),
            modules=sorted(list(recorded_modules)),
        )
    except Exception as e:
        print("get_audit_log_filters error:", e)
        return jsonify(error=str(e)), 500


def safe_csv_value(value):
    """
    Prevent spreadsheet formula execution in exported CSV cells.
    Prefix potentially executable values with an apostrophe.
    """
    if value is None:
        return ""

    text_value = str(value)

    if text_value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + text_value

    return text_value


@app.get("/admin/audit-logs/export")
def export_audit_logs():
    """
    Exports filtered audit logs as a downloadable CSV file.
    Logs the export event in admin_audit_logs.
    """
    admin_user = require_admin()
    if not admin_user:
        return jsonify(error="Unauthorized"), 401

    try:
        query = build_audit_query()
        query = query.order("created_at", desc=True).limit(2000)
        result = query.execute()
        rows = result.data or []

        # Generate CSV
        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)
        writer.writerow([
            "Log ID",
            "Timestamp (UTC)",
            "Admin Email",
            "Action",
            "Module",
            "Description",
            "Target Record ID",
            "IP Address",
            "Previous Values (JSON)",
            "Updated Values (JSON)",
        ])

        for r in rows:
            old_val_str = json.dumps(r.get("old_values")) if r.get("old_values") else ""
            new_val_str = json.dumps(r.get("new_values")) if r.get("new_values") else ""
            writer.writerow([
                safe_csv_value(r.get("id")),
                safe_csv_value(r.get("created_at")),
                safe_csv_value(r.get("admin_email")),
                safe_csv_value(r.get("action")),
                safe_csv_value(r.get("module")),
                safe_csv_value(r.get("description")),
                safe_csv_value(r.get("target_id")),
                safe_csv_value(r.get("ip_address")),
                safe_csv_value(old_val_str),
                safe_csv_value(new_val_str),
            ])

        # Record the audit export action
        log_admin_action(
            action="EXPORT_LOGS",
            module="AUDIT",
            description=f"Admin {admin_user.email} exported {len(rows)} audit log records to CSV",
            user=admin_user,
        )

        csv_data = output.getvalue()
        output.close()

        return Response(
            csv_data,
            mimetype="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=admin_audit_logs.csv",
                "Content-Type": "text/csv; charset=utf-8",
            },
        )
    except Exception as e:
        print("export_audit_logs error:", e)
        return jsonify(error=str(e)), 500


# =========================================================================
# PERFORMANCE / COMPUTER ARCHITECTURE METRICS (read-only)
# =========================================================================
def parse_ts(value):
    """Turns a Supabase timestamp string into a timezone-aware datetime."""
    if not value:
        return None
    try:
        s = str(value).replace("Z", "+00:00")
        # keep exactly 6 fractional digits (older Python versions need this)
        s = re.sub(r"\.(\d+)", lambda m: "." + (m.group(1) + "000000")[:6], s)
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def hours_between(start, end):
    if not start or not end:
        return None
    return max(0.0, (end - start).total_seconds() / 3600.0)


def stats_block(values):
    values = [v for v in values if v is not None]
    if not values:
        return {"count": 0, "avg": None, "min": None, "max": None}
    return {
        "count": len(values),
        "avg": round(sum(values) / len(values), 4),
        "min": round(min(values), 4),
        "max": round(max(values), 4),
    }


def number_views(n):
    """One integer shown in decimal, hexadecimal and binary."""
    n = int(n)
    return {"decimal": n, "hex": hex(n), "binary": bin(n)}


@app.get("/admin/performance")
def admin_performance():
    if not require_admin():
        return jsonify(error="Unauthorized"), 401
    try:
        # 1. Fetch the matches (a trip to the database = slow "main memory")
        fetch_start = time.perf_counter()
        rows = (
            sb.table("match_items")
            .select("created_at, lost_items(created_at)")
            .execute()
            .data
        ) or []
        fetch_ms = (time.perf_counter() - fetch_start) * 1000

        # 2. Calculate time-to-find (timed in nanoseconds)
        t0 = time.perf_counter_ns()
        find_hours = []
        latest = None  # (matched_at, lost_at) of the newest match
        for row in rows:
            matched_at = parse_ts(row.get("created_at"))
            lost_at = parse_ts((row.get("lost_items") or {}).get("created_at"))
            find_hours.append(hours_between(lost_at, matched_at))
            if matched_at and lost_at and (latest is None or matched_at > latest[0]):
                latest = (matched_at, lost_at)
        compute_ns = time.perf_counter_ns() - t0

        records = len(rows)
        compute_s = compute_ns / 1e9
        execution = {
            "records": records,
            "fetch_ms": round(fetch_ms, 3),
            "compute_ms": round(compute_ns / 1e6, 4),
            "us_per_record": round(compute_ns / 1000 / records, 3) if records else None,
            "throughput_per_sec": round(records / compute_s) if records and compute_s > 0 else None,
        }

        # 3. Cache numbers measured on real dashboard requests
        hits, misses = CACHE_STATS["hits"], CACHE_STATS["misses"]
        accesses = hits + misses
        cache = {
            "ttl_seconds": CACHE_TTL_SECONDS,
            "hits": hits,
            "misses": misses,
            "hit_ratio": round(hits / accesses, 4) if accesses else None,
            "hit_time_ms": None,
            "miss_penalty_ms": None,
            "amat_ms": None,
        }
        amdahl = {
            "auth_ms": None,
            "miss_ms": None,
            "hit_ms": None,
            "fraction_improved": None,
            "stage_speedup": None,
            "overall_speedup": None,
            "max_speedup": None,
        }
        if hits and misses:
            hit_ms = CACHE_STATS["hit_time_total"] / hits * 1000
            miss_ms = CACHE_STATS["miss_time_total"] / misses * 1000
            penalty_ms = max(0.0, miss_ms - hit_ms)  # EXTRA time a miss costs
            amat_ms = hit_ms + (misses / accesses) * penalty_ms
            cache["hit_time_ms"] = round(hit_ms, 5)
            cache["miss_penalty_ms"] = round(penalty_ms, 3)
            cache["amat_ms"] = round(amat_ms, 4)

            # 4. Amdahl's Law on a real dashboard request:
            #    request time = login check (not cached) + counts (cached or not)
            if AUTH_STATS["count"] and hit_ms > 0:
                auth_ms = AUTH_STATS["total"] / AUTH_STATS["count"] * 1000
                f = miss_ms / (auth_ms + miss_ms)  # part that the cache can speed up
                s = miss_ms / hit_ms               # how much faster that part gets
                amdahl.update(
                    auth_ms=round(auth_ms, 3),
                    miss_ms=round(miss_ms, 3),
                    hit_ms=round(hit_ms, 5),
                    fraction_improved=round(f, 4),
                    stage_speedup=round(s, 1),
                    overall_speedup=round(1 / ((1 - f) + f / s), 2),
                    max_speedup=round(1 / (1 - f), 2) if f < 1 else None,
                )

        # 5. Data representation: newest match, times as binary integers
        representation = None
        if latest:
            match_epoch = int(latest[0].timestamp())
            lost_epoch = int(latest[1].timestamp())
            representation = {
                "lost": number_views(lost_epoch),
                "match": number_views(match_epoch),
                "difference": number_views(max(0, match_epoch - lost_epoch)),
            }

        return jsonify(
            time_to_find=stats_block(find_hours),
            execution=execution,
            cache=cache,
            amdahl=amdahl,
            representation=representation,
        )
    except Exception as e:
        print("performance error:", e)
        return jsonify(error=str(e)), 500


# =========================================================================
# CACHE BENCHMARK (read-only, runs only when the dashboard button is clicked)
# =========================================================================
BENCH_TIME_BUDGET_S = 12  # stop early so the request does not hit the server time limit


def simulate_summary_requests(n, use_cache, clear_every=None):
    """Runs n dashboard-count lookups on a private cache and times each one."""
    store = None
    hits = misses = done = 0
    hit_total = miss_total = 0.0
    began = time.perf_counter()
    for i in range(1, n + 1):
        if time.perf_counter() - began > BENCH_TIME_BUDGET_S:
            break
        if clear_every and i > 1 and (i - 1) % clear_every == 0:
            store = None  # pretend something was written, so the cached copy is stale
        start = time.perf_counter()
        if use_cache and store is not None:
            _ = dict(store)  # cache hit
            hits += 1
            hit_total += time.perf_counter() - start
        else:
            store = fetch_summary_counts()  # cache miss: go to the database
            misses += 1
            miss_total += time.perf_counter() - start
        done += 1

    hit_ms = hit_total / hits * 1000 if hits else None
    miss_ms = miss_total / misses * 1000 if misses else None
    penalty_ms = max(0.0, miss_ms - hit_ms) if hits and misses else None
    if hits and misses:
        amat_ms = hit_ms + (misses / done) * penalty_ms
    else:
        amat_ms = miss_ms  # no hits: every access goes to the database
    return {
        "requests": done,
        "hits": hits,
        "misses": misses,
        "hit_ratio": round(hits / done, 4),
        "hit_time_ms": round(hit_ms, 5) if hit_ms is not None else None,
        "miss_penalty_ms": round(penalty_ms, 3) if penalty_ms is not None else None,
        "amat_ms": round(amat_ms, 4),
        "avg_ms": round((hit_total + miss_total) / done * 1000, 4),
        "total_ms": round((hit_total + miss_total) * 1000, 2),
    }


@app.get("/admin/benchmark")
def admin_benchmark():
    if not require_admin():
        return jsonify(error="Unauthorized"), 401
    try:
        try:
            n = int(request.args.get("n", 10))
        except ValueError:
            n = 10
        n = max(4, min(n, 20))

        setups = [
            ("No cache", simulate_summary_requests(n, use_cache=False)),
            ("Cache", simulate_summary_requests(n, use_cache=True)),
            (
                "Cache, cleared every 5th request",
                simulate_summary_requests(n, use_cache=True, clear_every=5),
            ),
        ]
        baseline = setups[0][1]["avg_ms"]
        results = []
        for name, r in setups:
            r["name"] = name
            r["speedup"] = round(baseline / r["avg_ms"], 1) if r["avg_ms"] > 0 else None
            results.append(r)
        return jsonify(requests=n, setups=results)
    except Exception as e:
        print("benchmark error:", e)
        return jsonify(error=str(e)), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_ENV") == "development" or os.environ.get("FLASK_DEBUG") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)