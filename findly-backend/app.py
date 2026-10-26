import os, json, base64
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from google import genai
from google.genai import types
from difflib import SequenceMatcher
from supabase import create_client

load_dotenv()
app = Flask(__name__)

# Always allow local development, plus anything listed in FRONTEND_URL (comma-separated).
origins = {"http://127.0.0.1:5500", "http://localhost:5500"}
for o in os.environ.get("FRONTEND_URL", "").split(","):
    o = o.strip().rstrip("/")
    if o:
        origins.add(o)
CORS(app, origins=sorted(origins))
print("CORS allowed origins:", sorted(origins))

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")  # change in .env if Google retires it again

# ---- ADDED: matching setup ----
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
THRESHOLD = 50
WEIGHTS = {"item_name": 40, "category": 15, "color": 15, "brand": 15, "marks": 15}

def sim(a, b):
    a, b = (a or "").strip().lower(), (b or "").strip().lower()
    return SequenceMatcher(None, a, b).ratio() if a and b else None

def score(claim, found):
    got = total = 0
    for k, w in WEIGHTS.items():
        s = sim(claim.get(k), found.get(k))
        if s is None: continue
        got += w * s; total += w
    return round(100 * got / total) if total else 0
# ---- END ADDED ----

PROMPT = """You help a school lost and found system. Look at the photo of the item and
return ONLY a JSON object with these keys:
item (REQUIRED: always give your best guess, e.g. "Black umbrella", never empty), category (one word, e.g. Bag, Electronics, Wallet, ID, Clothing, Keys, Other),
color, brand, size (small/medium/large or measurements if visible),
marks (visible marks, stickers, scratches, or text), desc (one short sentence).
Use an empty string for anything you cannot tell, except item, which must always be filled in with your best guess."""

@app.get("/")
def health():
    return "ok"

@app.post("/analyze")
def analyze():
    body = request.get_json(silent=True) or {}
    image = body.get("image")
    mime = body.get("mimeType", "image/jpeg")
    if not image:
        return jsonify(error="No image"), 400
    try:
        resp = client.models.generate_content(
            model=MODEL,
            contents=[types.Part.from_bytes(data=base64.b64decode(image), mime_type=mime), PROMPT],
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        return jsonify(json.loads(resp.text))
    except Exception as e:
        print("analyze error:", e)
        return jsonify(error=str(e)), 500

# ---- ADDED: /match endpoint ----
@app.post("/match")
def match():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    claim_id = (request.get_json(silent=True) or {}).get("claim_id")
    if not token or not claim_id:
        return jsonify(error="Missing data"), 400
    try:
        user = sb.auth.get_user(token).user
        claim = sb.table("claim_items").select("*").eq("id", claim_id).eq("user_id", user.id).single().execute().data
        pool = sb.table("found_items").select("*").neq("user_id", user.id).execute().data
        pool = [f for f in pool if f.get("status") != "claimed"]
        best = max(pool, key=lambda f: score(claim, f), default=None)
        s = score(claim, best) if best else 0
        if not best or s < THRESHOLD:
            return jsonify(match=None)
        row = sb.table("match_items").upsert(
            {"claim_item_id": claim_id, "found_item_id": best["id"], "score": s},
            on_conflict="claim_item_id,found_item_id"
        ).execute().data[0]
        keys = ("item_name", "category", "color", "brand", "marks", "place", "occurred_at", "photo_url")
        return jsonify(match={**{k: best.get(k) for k in keys}, "score": s, "match_id": row["id"]})
    except Exception as e:
        print("match error:", e)
        return jsonify(error=str(e)), 500

@app.post("/claim")
def claim():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    match_id = (request.get_json(silent=True) or {}).get("match_id")
    if not token or not match_id:
        return jsonify(error="Missing data"), 400
    try:
        user = sb.auth.get_user(token).user
        m = sb.table("match_items").select("claim_item_id").eq("id", match_id).single().execute().data
        owner = sb.table("claim_items").select("user_id").eq("id", m["claim_item_id"]).single().execute().data
        if owner["user_id"] != user.id:
            return jsonify(error="Not your match"), 403
        sb.table("match_items").update({"status": "pending"}).eq("id", match_id).execute()        return jsonify(ok=True)
    except Exception as e:
        print("claim error:", e)
        return jsonify(error=str(e)), 500
# ---- END ADDED ----

if __name__ == "__main__":
    app.run(debug=True)