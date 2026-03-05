#!/usr/bin/env python3
"""
server.py — MERIDIAN FastAPI backend.
Serves static files and provides /api/data + /api/health endpoints.
"""
import os
import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse

app = FastAPI(title="MERIDIAN CPO Intelligence Brief")

DATA_FILE = Path("data.json")
STATIC_DIR = Path("static")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/data")
def get_data():
    if DATA_FILE.exists():
        try:
            with open(DATA_FILE) as f:
                return JSONResponse(content=json.load(f))
        except Exception as e:
            return JSONResponse(content={"error": str(e)}, status_code=500)
    return JSONResponse(
        content={"status": "initializing", "message": "Data generation in progress..."},
        status_code=202
    )


# Serve static files (CSS, JS)
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"message": "MERIDIAN CPO Intelligence Brief - Static files not found"}


@app.get("/{path:path}")
def catch_all(path: str):
    # Try to serve from static directory
    file_path = STATIC_DIR / path
    if file_path.exists() and file_path.is_file():
        return FileResponse(str(file_path))
    # Default to index.html for SPA routing
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return JSONResponse(content={"error": "Not found"}, status_code=404)
