#!/usr/bin/env python3
"""
One-time import: Load labs-review-queue.json into the lab_review_queue PostgreSQL table.

Usage:
    python3 scripts/import-lab-review-queue.py

Prerequisites:
    - The migration 20260226_lab_review_queue.sql must have been run first.
    - .env.local must have DATABASE_* vars set.
"""

import json
import os
import sys

# Load env vars from .env.local
env_path = os.path.join(os.path.dirname(__file__), '..', '.env.local')
with open(env_path) as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, _, val = line.partition('=')
            os.environ[key.strip()] = val.strip()

import psycopg2
from psycopg2.extras import Json

conn = psycopg2.connect(
    host=os.environ['DATABASE_HOST'],
    port=int(os.environ.get('DATABASE_PORT', '5432')),
    dbname=os.environ['DATABASE_NAME'],
    user=os.environ['DATABASE_USER'],
    password=os.environ['DATABASE_PASSWORD'],
    sslmode='require',
    connect_timeout=10
)

JSON_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'labs-review-queue.json')

# All columns in the table (matching migration)
COLUMNS = [
    'id', 'source', 'accession', 'patient_name', 'dob', 'gender',
    'collection_date', 'healthie_id', 'patient_id', 'match_confidence',
    'matched_name', 'top_matches', 'tests_found', 'status',
    'created_at', 'uploaded_at', 'approved_at',
    'healthie_document_id', 'healthie_lab_order_id',
    'rejection_reason', 'pdf_path', 's3_key', 'upload_status',
    'severity', 'critical_tests', 'approved_by',
    'email_id', 'batch_date', 'batch_time', 'raw_result', 'patient_active'
]

# Columns that should be stored as JSONB
JSONB_COLUMNS = {'top_matches', 'tests_found', 'critical_tests', 'raw_result'}


def get_value(item, col):
    """Extract a value from a JSON item, wrapping JSONB columns appropriately."""
    val = item.get(col)
    if val is None:
        return None
    if col in JSONB_COLUMNS:
        return Json(val)
    return val


def main():
    print(f"Reading JSON file: {JSON_FILE}")
    with open(JSON_FILE) as f:
        items = json.load(f)
    print(f"Loaded {len(items)} records from JSON")

    cur = conn.cursor()
    
    # Build INSERT query
    placeholders = ', '.join(['%s'] * len(COLUMNS))
    col_names = ', '.join(COLUMNS)
    insert_sql = f"""
        INSERT INTO lab_review_queue ({col_names})
        VALUES ({placeholders})
        ON CONFLICT (id) DO NOTHING
    """

    inserted = 0
    skipped = 0
    errors = 0

    for i, item in enumerate(items):
        try:
            values = [get_value(item, col) for col in COLUMNS]
            cur.execute(insert_sql, values)
            if cur.rowcount > 0:
                inserted += 1
            else:
                skipped += 1
        except Exception as e:
            errors += 1
            conn.rollback()
            print(f"  Error importing item {item.get('id', '?')}: {e}", file=sys.stderr)
            continue

        if (i + 1) % 25 == 0:
            print(f"  Progress: {i+1}/{len(items)} processed ({inserted} inserted, {skipped} skipped, {errors} errors)")

    conn.commit()

    print(f"\n=== Import Complete ===")
    print(f"  Inserted: {inserted}")
    print(f"  Skipped (duplicates): {skipped}")
    print(f"  Errors: {errors}")
    print(f"  Total processed: {inserted + skipped + errors}")

    # Verify count
    cur.execute("SELECT COUNT(*) FROM lab_review_queue")
    print(f"  Rows in table: {cur.fetchone()[0]}")

    # Show status breakdown
    cur.execute("SELECT status, COUNT(*) FROM lab_review_queue GROUP BY status ORDER BY status")
    print(f"\n  Status breakdown:")
    for row in cur.fetchall():
        print(f"    {row[0]}: {row[1]}")

    cur.close()
    conn.close()


if __name__ == '__main__':
    main()
