#!/usr/bin/env python3
"""
start.py — MERIDIAN startup orchestrator for Railway.
1. Runs initial data generation in a background thread
2. Starts the FastAPI server on $PORT (Railway-injected)
3. Schedules data refresh every 24 hours via APScheduler
"""
import os
import sys
import threading
import subprocess
import time

from apscheduler.schedulers.background import BackgroundScheduler


def run_data_generation():
    """Run generate_data.py as a subprocess."""
    print("[MERIDIAN] Starting data generation...", flush=True)
    try:
        result = subprocess.run(
            [sys.executable, "generate_data.py"],
            capture_output=True, text=True, timeout=600,
            cwd=os.path.dirname(os.path.abspath(__file__))
        )
        if result.returncode == 0:
            print("[MERIDIAN] Data generation complete.", flush=True)
        else:
            print(f"[MERIDIAN] Data generation failed:\n{result.stderr}", flush=True)
    except subprocess.TimeoutExpired:
        print("[MERIDIAN] Data generation timed out.", flush=True)
    except Exception as e:
        print(f"[MERIDIAN] Data generation error: {e}", flush=True)


def main():
    # Start data generation in background thread
    gen_thread = threading.Thread(target=run_data_generation, daemon=True)
    gen_thread.start()

    # Set up 24-hour refresh scheduler
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        run_data_generation,
        'interval',
        hours=24,
        id='data_refresh',
        replace_existing=True
    )
    scheduler.start()
    print("[MERIDIAN] 24h data refresh scheduler started.", flush=True)

    # Start FastAPI server
    port = int(os.environ.get("PORT", 8000))
    print(f"[MERIDIAN] Starting server on port {port}...", flush=True)

    import uvicorn
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=port,
        log_level="info"
    )


if __name__ == "__main__":
    main()
