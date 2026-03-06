#!/usr/bin/env python3
"""
Intelligence Brief Server — Serves intelligence data + static frontend files.
For Railway deployment: serves everything from one process on $PORT.
"""
import json
import os
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response

DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

# CORS: restrict to Railway domain + localhost for dev
ALLOWED_ORIGINS = [
    "https://procenergybrief.up.railway.app",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def load_data():
    """Load data.json with atomic read protection — handles partial writes gracefully."""
    if not os.path.exists(DATA_FILE):
        return None
    try:
        with open(DATA_FILE) as f:
            raw = f.read()
        return json.loads(raw)
    except (json.JSONDecodeError, IOError) as e:
        # File might be mid-write — return None so the API returns 'generating' state
        print(f"[server] data.json read error (likely mid-write): {e}")
        return None


@app.get("/api/intelligence")
async def get_intelligence():
    data = load_data()
    if data:
        return data
    return {"status": "generating", "message": "Intelligence data is being generated. Please wait..."}


@app.get("/api/export-pdf")
async def export_pdf():
    data = load_data()
    if not data or data.get("status") != "ok":
        return Response(content="No data available", status_code=503)
    try:
        from pdf_brief import generate_pdf
        pdf_bytes = generate_pdf(data)
    except Exception as e:
        print(f"[server] PDF generation error: {e}")
        import traceback
        traceback.print_exc()
        return Response(
            content=json.dumps({"error": "PDF generation failed", "detail": str(e)[:200]}),
            status_code=422,
            media_type="application/json",
        )
    date_str = datetime.now().strftime("%Y-%m-%d")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="Intelligence_Brief_{date_str}.pdf"'}
    )


@app.get("/api/health")
async def health():
    data = load_data()
    has_real_data = data is not None and data.get("status") == "ok"
    return {
        "status": "ok",
        "has_data": has_real_data,
        "timestamp": data.get("timestamp") if data else None
    }


# Serve index.html at root
@app.get("/")
async def root():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# Mount static files under /static path to avoid route conflicts
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# Catch-all: serve static files for any remaining paths (CSS, JS loaded from ./)
@app.get("/{file_path:path}")
async def serve_static(file_path: str):
    full_path = os.path.join(STATIC_DIR, file_path)
    if os.path.isfile(full_path):
        return FileResponse(full_path)
    # Fallback to index.html for SPA-style routing
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
