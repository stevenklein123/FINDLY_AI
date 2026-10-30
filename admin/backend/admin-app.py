"""
Admin backend for the Lost & Found system (separate from app.py).

Run:      python admin-app.py      -> http://127.0.0.1:5001
Install:  pip install flask flask-cors python-dotenv supabase

.env needs:
    SUPABASE_URL=...
    SUPABASE_SERVICE_KEY=...        (service_role key, NEVER put this in HTML)
    ADMIN_EMAILS=admin@school.edu   (comma-separated; empty = any logged-in user, dev only)
    FRONTEND_URL=http://127.0.0.1:5500   (optional, comma-separated)
"""
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
app = Flask(__name__)

# ---- CORS ----
CORS(app, resources={r"/*": {"origins": "*"}})

# ---- Supabase (service key: bypasses RLS, so we check admin ourselves) ----
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("ADMIN_EMAILS", "").split(",")
    if e.strip()
}
if not ADMIN_EMAILS:
    print("WARNING: ADMIN_EMAILS is empty, any logged-in user can use /admin routes")

# kind -> (table, filters). Keys match the data-stat names in the dashboard.
LISTS = {
    "missing_items": ("claim_items", {}),
    "found_items": ("found_items", {}),
    "match_items": ("match_items", {}),
    "claimed": ("match_items", {"status": "claimed"}),
}


def require_admin():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        return None
    try:
        user = sb.auth.get_user(token).user
    except Exception:
        return None
    if not user:
        return None
    if ADMIN_EMAILS and (user.email or "").lower() not in ADMIN_EMAILS:
        return None
    return user


def count(table, **eq):
    q = sb.table(table).select("id", count="exact")
    for k, v in eq.items():
        q = q.eq(k, v)
    return q.limit(1).execute().count or 0


@app.get("/")
def health():
    return "admin ok"


@app.get("/admin/summary")
def admin_summary():
    if not require_admin():
        return jsonify(error="Unauthorized"), 401
    try:
        return jsonify(
            missing_items=count("claim_items"),
            found_items=count("found_items"),
            match_items=count("match_items"),
            claimed=count("match_items", status="claimed"),
        )
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
        cols = "*, claim_items(*), found_items(*)" if table == "match_items" else "*"
        q = sb.table(table).select(cols).order("created_at", desc=True)
        for k, v in filters.items():
            q = q.eq(k, v)
        return jsonify(q.execute().data)
    except Exception as e:
        print("list error:", e)
        return jsonify(error=str(e)), 500


@app.post("/admin/claim/<match_id>")
def admin_mark_claimed(match_id):
    if not require_admin():
        return jsonify(error="Unauthorized"), 401
    try:
        m = (
            sb.table("match_items")
            .select("claim_item_id, found_item_id")
            .eq("id", match_id)
            .single()
            .execute()
            .data
        )
        if not m:
            return jsonify(error="Match not found"), 404
        sb.table("match_items").update({"status": "claimed"}).eq("id", match_id).execute()
        if m.get("found_item_id"):
            sb.table("found_items").update({"status": "claimed"}).eq("id", m["found_item_id"]).execute()
        if m.get("claim_item_id"):
            sb.table("claim_items").update({"status": "claimed"}).eq("id", m["claim_item_id"]).execute()
        return jsonify(ok=True)
    except Exception as e:
        print("admin claim error:", e)
        return jsonify(error=str(e)), 500


if __name__ == "__main__":
    app.run(port=5001, debug=True)
