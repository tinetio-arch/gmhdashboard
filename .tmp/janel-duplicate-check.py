#!/usr/bin/env python3
"""Show both Janel Freeman rows so we can decide which to keep."""
from dotenv import dotenv_values
import psycopg2
from psycopg2.extras import RealDictCursor

ENV = dotenv_values('/home/ec2-user/gmhdashboard/.env.local')
PG = dict(host=ENV['DATABASE_HOST'], port=int(ENV['DATABASE_PORT']),
          dbname=ENV['DATABASE_NAME'], user=ENV['DATABASE_USER'],
          password=ENV['DATABASE_PASSWORD'],
          sslmode=ENV.get('DATABASE_SSLMODE', 'require'))

conn = psycopg2.connect(**PG)
cur = conn.cursor(cursor_factory=RealDictCursor)

cur.execute("""
    SELECT patient_id, healthie_client_id, full_name, email, dob,
           patient_type, client_type, status_key, created_at, updated_at
    FROM patients
    WHERE healthie_client_id IN ('12745763','12745768')
       OR lower(email) = 'jrfreeman1983@outlook.com'
    ORDER BY created_at
""")
rows = cur.fetchall()
print(f'Found {len(rows)} rows:')
for r in rows:
    print('---')
    for k,v in r.items():
        print(f'  {k}: {v}')

# Check which has real activity: appointments, dispenses, payments, charts
for r in rows:
    pid = r['patient_id']
    cur.execute("SELECT COUNT(*) c FROM appointments WHERE patient_id=%s", (pid,))
    apts = cur.fetchone()['c']
    try:
        cur.execute("SELECT COUNT(*) c FROM dispenses WHERE patient_id=%s", (pid,))
        disp = cur.fetchone()['c']
    except Exception as e:
        conn.rollback()
        disp = f'err({e.__class__.__name__})'
    try:
        cur.execute("SELECT COUNT(*) c FROM peptide_orders WHERE patient_id=%s", (pid,))
        pep = cur.fetchone()['c']
    except Exception:
        conn.rollback(); pep = 'n/a'
    try:
        cur.execute("SELECT COUNT(*) c FROM lab_orders WHERE patient_id=%s", (pid,))
        labs = cur.fetchone()['c']
    except Exception:
        conn.rollback(); labs = 'n/a'
    print(f"  activity for {r['healthie_client_id']} (pid {pid}): apts={apts} disp={disp} peptides={pep} labs={labs}")

conn.close()
