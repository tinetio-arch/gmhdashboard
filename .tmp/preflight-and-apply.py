#!/usr/bin/env python3
"""
Safe, transactional runner for 3 actions requested 2026-04-24:
  1. Flip 3 patients from patient_type='visit' to 'member'
  2. Repoint healthie_client_id for 2 Healthie-duplicate members (Bruce, Janel)
  3. Bucket B audit: last activity signals for 48 Now*.Care members without
     active Healthie packages (LOCAL DB ONLY — no Healthie calls)

Safety:
  - Steps 1+2 run in a SINGLE transaction. If any pre-check fails, ROLLBACK.
  - Pre-check for step 2 verifies the TARGET healthie_id is NOT already
    present in patients (would be a duplicate row).
  - All before/after row counts printed for manual verification.
"""
import sys
from dotenv import dotenv_values
import psycopg2
from psycopg2.extras import RealDictCursor

ENV = dotenv_values('/home/ec2-user/gmhdashboard/.env.local')
PG = dict(host=ENV['DATABASE_HOST'], port=int(ENV['DATABASE_PORT']),
          dbname=ENV['DATABASE_NAME'], user=ENV['DATABASE_USER'],
          password=ENV['DATABASE_PASSWORD'],
          sslmode=ENV.get('DATABASE_SSLMODE', 'require'))

FLIPS = [
    ('12745494', "Richard O'Connor", 'NowMensHealth.Care TRT $180/mo'),
    ('14167760', "Stephanie O'Deay", 'NowOptimal Primary Care Premier $50/mo'),
    ('14989559', 'Karla Shafer',     'NowOptimal Primary Care Premier $50/mo'),
]

# Healthie duplicates: repoint GMH row at the package-holder's Healthie ID
# Janel deferred — target hid already in patients (duplicate row needs manual merge).
REPOINTS = [
    # (current_hid_on_gmh, target_hid_with_package, name)
    ('12745786', '12765861', 'Bruce French'),
]

def section(t): print(f'\n{"="*8} {t} {"="*8}', flush=True)

conn = psycopg2.connect(**PG)
conn.autocommit = False
cur = conn.cursor(cursor_factory=RealDictCursor)

try:
    # ---------- Preflight for step 1 ----------
    section('STEP 1 PREFLIGHT — flip visit→member')
    cur.execute("""
        SELECT healthie_client_id, full_name, patient_type, client_type
        FROM patients
        WHERE healthie_client_id = ANY(%s)
        ORDER BY full_name
    """, ([f[0] for f in FLIPS],))
    before_flip = cur.fetchall()
    for r in before_flip:
        print(f"  {r['healthie_client_id']:<10} {r['full_name']:<22} {r['patient_type']:<10} {r['client_type']}")
    if len(before_flip) != 3:
        raise RuntimeError(f'Expected 3 rows, found {len(before_flip)} — aborting')
    # All three must currently be 'visit'
    wrong = [r for r in before_flip if r['patient_type'] != 'visit']
    if wrong:
        print(f'  WARN: {len(wrong)} rows already not "visit" — guard will no-op them')

    # ---------- Preflight for step 2 ----------
    section('STEP 2 PREFLIGHT — check Healthie duplicate repoints')
    for cur_hid, tgt_hid, name in REPOINTS:
        cur.execute("SELECT healthie_client_id, full_name, patient_type FROM patients WHERE healthie_client_id=%s", (tgt_hid,))
        tgt = cur.fetchall()
        cur.execute("SELECT healthie_client_id, full_name, patient_type FROM patients WHERE healthie_client_id=%s", (cur_hid,))
        src = cur.fetchall()
        print(f"  {name}: GMH row has hid={cur_hid} ({len(src)} row) / target hid={tgt_hid} ({len(tgt)} rows)")
        if len(src) != 1:
            raise RuntimeError(f'{name}: expected 1 row at {cur_hid}, found {len(src)}')
        if len(tgt) != 0:
            raise RuntimeError(f'{name}: target hid {tgt_hid} already in patients! ({len(tgt)} rows) — aborting to avoid duplicate')
        print(f"    OK: target clean, src row present")

    # ---------- Apply step 1 ----------
    section('STEP 1 APPLY')
    cur.execute("""
        UPDATE patients
           SET patient_type='member', updated_at=NOW()
         WHERE healthie_client_id = ANY(%s)
           AND patient_type='visit'
        RETURNING healthie_client_id, full_name, patient_type
    """, ([f[0] for f in FLIPS],))
    flipped = cur.fetchall()
    print(f'  Flipped {len(flipped)} rows:')
    for r in flipped:
        print(f"    {r['healthie_client_id']} {r['full_name']} → {r['patient_type']}")

    # ---------- Apply step 2 ----------
    section('STEP 2 APPLY')
    for cur_hid, tgt_hid, name in REPOINTS:
        cur.execute("""
            UPDATE patients
               SET healthie_client_id=%s, updated_at=NOW()
             WHERE healthie_client_id=%s
            RETURNING patient_id, full_name, healthie_client_id
        """, (tgt_hid, cur_hid))
        res = cur.fetchall()
        for r in res:
            print(f"  {name}: patient_id={r['patient_id']} now hid={r['healthie_client_id']}")
        if len(res) != 1:
            raise RuntimeError(f'{name} repoint affected {len(res)} rows')

    # ---------- Post-check ----------
    section('POST-APPLY VERIFICATION')
    cur.execute("""
        SELECT healthie_client_id, full_name, patient_type, client_type
        FROM patients
        WHERE healthie_client_id = ANY(%s) OR healthie_client_id = ANY(%s)
        ORDER BY full_name
    """, ([f[0] for f in FLIPS], [r[1] for r in REPOINTS]))
    for r in cur.fetchall():
        print(f"  {r['healthie_client_id']:<10} {r['full_name']:<22} {r['patient_type']:<10} {r['client_type']}")

    conn.commit()
    print('\n*** COMMITTED ***')

except Exception as e:
    conn.rollback()
    print(f'\n!!! ROLLED BACK !!! — {e}', file=sys.stderr)
    sys.exit(1)
finally:
    conn.close()
