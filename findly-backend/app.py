import os, json, base64
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from google import genai
from google.genai import types

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

if __name__ == "__main__":
    app.run(debug=True)