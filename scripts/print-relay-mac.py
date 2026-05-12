#!/usr/bin/env python3
"""
NOW Optimal Print Relay — runs on clinic Mac
Polls the server for pending print jobs and sends them to local CUPS printers.

Usage:
    python3 print-relay-mac.py
"""

import json
import base64
import subprocess
import time
import os
import sys
import urllib.request

URL = "https://nowoptimal.com/ops/api/labels/print/"
KEY = "d93a45ad7c2a58732839966cb9b06ff59acb95a9e9161a07957cb817d9b10fe6"
POLL_INTERVAL = 5

def fetch_jobs():
    try:
        req = urllib.request.Request(
            URL + "?status=pending",
            headers={"x-print-secret": KEY}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data.get("jobs", [])
    except Exception as e:
        return []

def mark_done(job_id, status="printed", error=None):
    try:
        body = json.dumps({"id": job_id, "status": status, "error": error}).encode()
        req = urllib.request.Request(
            URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                "x-print-secret": KEY,
            },
            method="PATCH"
        )
        urllib.request.urlopen(req, timeout=10)
    except:
        pass

def print_job(job):
    job_id = job["id"]
    printer = job.get("printer", "DYMO_LabelWriter_450")
    pdf_b64 = job.get("pdf_base64")

    if not pdf_b64:
        print(f"  Job #{job_id}: no PDF data, skipping")
        mark_done(job_id, "failed", "No PDF data")
        return

    pdf_path = f"/tmp/print_job_{job_id}.pdf"
    try:
        with open(pdf_path, "wb") as f:
            f.write(base64.b64decode(pdf_b64))

        print(f"  Job #{job_id} -> {printer} ({os.path.getsize(pdf_path)} bytes)")

        # Build lp command with printer-specific options
        lp_cmd = ["lp", "-d", printer]

        # Zebra labels: force 3x2" media and fit-to-page
        if "Zebra" in printer or "zebra" in printer:
            lp_cmd += ["-o", "media=Custom.3x2in", "-o", "fit-to-page"]

        lp_cmd.append(pdf_path)

        result = subprocess.run(
            lp_cmd,
            capture_output=True, text=True, timeout=30
        )

        if result.returncode == 0:
            print(f"  PRINTED: {result.stdout.strip()}")
            mark_done(job_id, "printed")
        else:
            err = result.stderr.strip() or result.stdout.strip()
            print(f"  FAILED: {err}")
            mark_done(job_id, "failed", err[:200])

    except Exception as e:
        print(f"  ERROR: {e}")
        mark_done(job_id, "failed", str(e)[:200])
    finally:
        if os.path.exists(pdf_path):
            os.remove(pdf_path)

if __name__ == "__main__":
    print("=" * 50)
    print("  NOW Optimal Print Relay")
    print(f"  Polling {URL}")
    print(f"  Interval: {POLL_INTERVAL}s")
    print("=" * 50)

    while True:
        try:
            jobs = fetch_jobs()
            if jobs:
                print(f"\n[{time.strftime('%H:%M:%S')}] {len(jobs)} job(s) found:")
                for job in jobs:
                    print_job(job)
        except KeyboardInterrupt:
            print("\nRelay stopped.")
            sys.exit(0)
        except Exception as e:
            pass

        time.sleep(POLL_INTERVAL)
