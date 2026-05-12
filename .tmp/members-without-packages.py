#!/usr/bin/env python3
"""
Members in GMH dashboard who are NOT on active Healthie recurring packages.

Reads 208 recurring Healthie IDs from /tmp/healthie-recurring.json, queries the
GMH patients table for patient_type='member' rows, and outputs:
- /tmp/members-without-packages.csv    (full detail)
- Summary printed to stdout grouped by client_type
"""
import json, os, csv, sys
from dotenv import dotenv_values
import psycopg2

ENV = dotenv_values('/home/ec2-user/gmhdashboard/.env.local')
PG_KWARGS = dict(
    host=ENV['DATABASE_HOST'],
    port=int(ENV['DATABASE_PORT']),
    dbname=ENV['DATABASE_NAME'],
    user=ENV['DATABASE_USER'],
    password=ENV['DATABASE_PASSWORD'],
    sslmode=ENV.get('DATABASE_SSLMODE', 'require'),
)

# Load recurring IDs from cache
recurring = json.load(open('/tmp/healthie-recurring.json'))
recurring_ids = {str(u['id']) for u in recurring}
print(f'Loaded {len(recurring_ids)} Healthie IDs with active recurring packages', flush=True)

conn = psycopg2.connect(**PG_KWARGS)
cur = conn.cursor()

cur.execute("""
    SELECT healthie_client_id, full_name, email, patient_type, client_type,
           client_type_key, status_key, created_at
    FROM patients
    WHERE patient_type = 'member'
      AND (status_key IS NULL OR status_key NOT IN ('inactive','revoked','suspended'))
    ORDER BY client_type NULLS LAST, full_name
""")
rows = cur.fetchall()
print(f'GMH members (active): {len(rows)}', flush=True)

no_package = []
with_package = 0
no_healthie_id = 0
for r in rows:
    hid, name, email, ptype, ctype, ckey, skey, created = r
    if not hid:
        no_healthie_id += 1
        no_package.append(r + ('no_healthie_id',))
        continue
    if str(hid) in recurring_ids:
        with_package += 1
    else:
        no_package.append(r + ('no_active_package',))

print(f'  With active recurring package: {with_package}')
print(f'  WITHOUT active recurring package: {len(no_package)}')
print(f'    (of which {no_healthie_id} have no healthie_client_id at all)')
print()

# Group by client_type for summary
by_ctype = {}
for r in no_package:
    ctype = r[4] or '(null)'
    by_ctype.setdefault(ctype, []).append(r)

print('=== Members WITHOUT active Healthie recurring package, grouped by client_type ===')
for ctype in sorted(by_ctype.keys()):
    print(f'  {ctype}: {len(by_ctype[ctype])}')

# Write CSV
out = '/tmp/members-without-packages.csv'
with open(out, 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['healthie_id', 'full_name', 'email', 'patient_type',
                'client_type', 'client_type_key', 'status_key', 'created_at', 'reason'])
    for r in no_package:
        w.writerow(r)

print(f'\nWrote {len(no_package)} rows to {out}')
conn.close()
