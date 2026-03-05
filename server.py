#!/usr/bin/env python3
"""
Intelligence Brief Server — Serves intelligence data + static frontend files.
For Railway deployment: serves everything from one process on $PORT.
"""
import json
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def load_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE) as f:
            return json.load(f)
    return None


@app.get("/api/intelligence")
async def get_intelligence():
    data = load_data()
    if data:
        return data
    return {"status": "generating", "message": "Intelligence data is being generated. Please wait..."}


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


# Mount static files (CSS, JS, etc.)
app.mount("/", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
