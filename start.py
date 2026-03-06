#!/usr/bin/env python3
"""
start.py — Intelligence Brief startup orchestrator for Railway.
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
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_MISSED


def run_data_generation():
    """Run generate_data.py as a subprocess."""
    print("[INTEL-BRIEF] Starting data generation...", flush=True)
    try:
        result = subprocess.run(
            [sys.executable, "generate_data.py"],
            capture_output=True, text=True, timeout=600,
            cwd=os.path.dirname(os.path.abspath(__file__))
        )
        print(result.stdout, flush=True)
        if result.returncode != 0:
            print(f"[INTEL-BRIEF] Data generation error:\n{result.stderr}", flush=True)
        else:
            print("[INTEL-BRIEF] Data generation complete.", flush=True)
    except subprocess.TimeoutExpired:
        print("[INTEL-BRIEF] Data generation timed out after 600s.", flush=True)
    except Exception as e:
        print(f"[INTEL-BRIEF] Data generation failed: {e}", flush=True)


def scheduler_error_listener(event):
    """Log scheduler errors and missed jobs."""
    if event.exception:
        print(f"[INTEL-BRIEF] Scheduler job {event.job_id} crashed: {event.exception}", flush=True)
    else:
        print(f"[INTEL-BRIEF] Scheduler event: {event}", flush=True)


def main():
    port = int(os.environ.get("PORT", 8000))

    # Run initial data generation in background thread so server starts immediately
    gen_thread = threading.Thread(target=run_data_generation, daemon=True)
    gen_thread.start()

    # Schedule 24-hour refresh with misfire resilience:
    # - misfire_grace_time=3600: if a job fires up to 1hr late (e.g. after Railway redeploy), still run it
    # - coalesce=True: if multiple misfired runs stacked up, only run one
    # - max_instances=1: prevent overlapping runs
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        run_data_generation,
        "interval",
        hours=24,
        id="data_refresh",
        misfire_grace_time=3600,
        coalesce=True,
        max_instances=1,
    )
    scheduler.add_listener(scheduler_error_listener, EVENT_JOB_ERROR | EVENT_JOB_MISSED)
    scheduler.start()
    print(f"[INTEL-BRIEF] Scheduled data refresh every 24 hours (misfire grace: 1hr).", flush=True)

    # Start the FastAPI server (blocking)
    print(f"[INTEL-BRIEF] Starting server on port {port}...", flush=True)
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
