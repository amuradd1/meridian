#!/usr/bin/env python3
"""
start.py — Intelligence Brief startup orchestrator for Railway.
1. Runs initial full data generation in a background thread
2. Starts the FastAPI server on $PORT (Railway-injected)
3. Schedules:
   - price_refresh every 4 hours (free API calls: Yahoo, PortWatch, FBX, Google News)
   - full_refresh daily at 07:30 UK time (LLM intelligence analysis)
"""
import os
import sys
import threading
import asyncio
import subprocess

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_MISSED


def run_full_refresh():
    """Run a full refresh (prices + LLM) as a subprocess."""
    print("[INTEL-BRIEF] Starting FULL refresh (prices + LLM)...", flush=True)
    try:
        result = subprocess.run(
            [sys.executable, "-c",
             "import asyncio; from generate_data import full_refresh; asyncio.run(full_refresh())"],
            capture_output=True, text=True, timeout=600,
            cwd=os.path.dirname(os.path.abspath(__file__))
        )
        print(result.stdout, flush=True)
        if result.returncode != 0:
            print(f"[INTEL-BRIEF] Full refresh error:\n{result.stderr}", flush=True)
        else:
            print("[INTEL-BRIEF] Full refresh complete.", flush=True)
    except subprocess.TimeoutExpired:
        print("[INTEL-BRIEF] Full refresh timed out after 600s.", flush=True)
    except Exception as e:
        print(f"[INTEL-BRIEF] Full refresh failed: {e}", flush=True)


def run_price_refresh():
    """Run a price-only refresh (no LLM) as a subprocess."""
    print("[INTEL-BRIEF] Starting PRICE-ONLY refresh...", flush=True)
    try:
        result = subprocess.run(
            [sys.executable, "-c",
             "import asyncio; from generate_data import price_refresh; asyncio.run(price_refresh())"],
            capture_output=True, text=True, timeout=300,
            cwd=os.path.dirname(os.path.abspath(__file__))
        )
        print(result.stdout, flush=True)
        if result.returncode != 0:
            print(f"[INTEL-BRIEF] Price refresh error:\n{result.stderr}", flush=True)
        else:
            print("[INTEL-BRIEF] Price refresh complete.", flush=True)
    except subprocess.TimeoutExpired:
        print("[INTEL-BRIEF] Price refresh timed out after 300s.", flush=True)
    except Exception as e:
        print(f"[INTEL-BRIEF] Price refresh failed: {e}", flush=True)


def scheduler_error_listener(event):
    """Log scheduler errors and missed jobs."""
    if event.exception:
        print(f"[INTEL-BRIEF] Scheduler job {event.job_id} crashed: {event.exception}", flush=True)
    else:
        print(f"[INTEL-BRIEF] Scheduler event: {event}", flush=True)


def main():
    port = int(os.environ.get("PORT", 8000))

    # Run initial full refresh in background thread so server starts immediately
    gen_thread = threading.Thread(target=run_full_refresh, daemon=True)
    gen_thread.start()

    scheduler = BackgroundScheduler()

    # ── Price-only refresh: every 4 hours ──
    # Free API calls (Yahoo Finance, IMF PortWatch, FBX, Google News)
    # Preserves existing intelligence analysis
    scheduler.add_job(
        run_price_refresh,
        "interval",
        hours=4,
        id="price_refresh",
        misfire_grace_time=3600,
        coalesce=True,
        max_instances=1,
    )

    # ── Full intelligence refresh: daily at 07:30 UK time ──
    # Uses CronTrigger with Europe/London timezone so it automatically
    # adjusts for BST (06:30 UTC in summer) vs GMT (07:30 UTC in winter)
    scheduler.add_job(
        run_full_refresh,
        CronTrigger(hour=7, minute=30, timezone="Europe/London"),
        id="full_refresh",
        misfire_grace_time=3600,
        coalesce=True,
        max_instances=1,
    )

    scheduler.add_listener(scheduler_error_listener, EVENT_JOB_ERROR | EVENT_JOB_MISSED)
    scheduler.start()
    print("[INTEL-BRIEF] Scheduled: price refresh every 4h, full refresh daily 07:30 UK time.", flush=True)

    # Start the FastAPI server (blocking)
    print(f"[INTEL-BRIEF] Starting server on port {port}...", flush=True)
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
