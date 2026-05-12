#!/usr/bin/env python3
"""
CORRECTED audit: who in GMH has an active Healthie recurring PAYMENT.

Previously used `userPackageSelections` which returned empty for many
actively-paying users. The correct query is `recurringPayments(user_id)`.

For each GMH active member, fetch recurringPayments and classify:
  - active (is_canceled=false AND is_paused=false AND next_payment_date set)
  - canceled / paused / no-recurring
"""
import json, time, sys, csv
from dotenv import dotenv_values
import urllib.request, urllib.error
import psycopg2
from psycopg2.extras import RealDictCursor

ENV = dotenv_values('/home/ec2-user/gmhdashboard/.env.local')
PG = dict(host=ENV['DATABASE_HOST'], port=int(ENV['DATABASE_PORT']),
          dbname=ENV['DATABASE_NAME'], user=ENV['DATABASE_USER'],
          password=ENV['DATABASE_PASSWORD'],
          sslmode=ENV.get('DATABASE_SSLMODE', 'require'))
API = 'https://api.gethealthie.com/graphql'
KEY = ENV['HEALTHIE_API_KEY']
THROTTLE = 0.5  # 2 req/sec — well under Healthie's 100/sec limit

def gql(q, v=None, retries=3):
    data = json.dumps({'query':q,'variables':v or {}}).encode()
    headers = {'Content-Type':'application/json','Authorization':f'Basic {KEY}','AuthorizationSource':'API'}
    for attempt in range(retries):
        try:
            req = urllib.request.Request(API, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503) and attempt < retries-1:
                time.sleep(2**attempt); continue
            raise
        except Exception:
            if attempt < retries-1:
                time.sleep(1); continue
            raise

Q = '''query($uid: ID) {
    recurringPayments(user_id: $uid) {
        id offering_name original_price billing_frequency
        is_canceled is_paused next_payment_date canceled_at paused_at start_at
    }
}'''

conn = psycopg2.connect(**PG)
cur = conn.cursor(cursor_factory=RealDictCursor)

cur.execute("""
    SELECT healthie_client_id, full_name, email, patient_type, client_type, status_key
    FROM patients
    WHERE healthie_client_id IS NOT NULL
      AND (status_key IS NULL OR status_key NOT IN ('inactive','revoked','suspended'))
    ORDER BY full_name
""")
pts = cur.fetchall()
print(f'Checking {len(pts)} active GMH patients via recurringPayments', flush=True)

results = []
for i, p in enumerate(pts, 1):
    hid = p['healthie_client_id']
    try:
        d = gql(Q, {'uid': hid})
        payments = (d.get('data') or {}).get('recurringPayments') or []
    except Exception as e:
        payments = []
        print(f'  [{i}/{len(pts)}] ERR {hid}: {e}', flush=True)

    active = [rp for rp in payments if not rp.get('is_canceled') and not rp.get('is_paused') and rp.get('next_payment_date')]
    canceled = [rp for rp in payments if rp.get('is_canceled')]
    paused = [rp for rp in payments if rp.get('is_paused')]

    results.append({
        'healthie_id': hid,
        'full_name': p['full_name'],
        'email': p['email'] or '',
        'patient_type': p['patient_type'] or '',
        'client_type': p['client_type'] or '',
        'active_pkgs': '; '.join(f'{rp["offering_name"]}|${rp["original_price"]}|{rp["billing_frequency"]}|next={rp["next_payment_date"]}' for rp in active),
        'active_count': len(active),
        'canceled_count': len(canceled),
        'paused_count': len(paused),
        'total_rps': len(payments),
    })
    if i % 25 == 0 or i == len(pts):
        print(f'  [{i}/{len(pts)}] active_so_far={sum(1 for r in results if r["active_count"])}', flush=True)
    time.sleep(THROTTLE)

# Save full + split out "without active package"
with open('/tmp/audit-v2-all.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(results[0].keys()))
    w.writeheader(); w.writerows(results)

no_active = [r for r in results if r['active_count'] == 0]
print(f'\n=== SUMMARY ===')
print(f'Total active GMH patients checked: {len(results)}')
print(f'  With active recurring payment: {len(results) - len(no_active)}')
print(f'  WITHOUT active recurring payment: {len(no_active)}')

# Of the no_active, how many are patient_type='member'?
members_no = [r for r in no_active if r['patient_type'] == 'member']
print(f'  Of no-active, are patient_type=member: {len(members_no)}')

# By client_type
from collections import Counter
by_ctype = Counter(r['client_type'] or '(null)' for r in members_no)
print(f'\n=== Members without active recurring — by client_type ===')
for ct, c in by_ctype.most_common():
    print(f'  {c:>3}  {ct}')

with open('/tmp/audit-v2-members-no-active.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(members_no[0].keys()))
    w.writeheader(); w.writerows(members_no)
print(f'\nSaved:\n  /tmp/audit-v2-all.csv (all {len(results)})\n  /tmp/audit-v2-members-no-active.csv ({len(members_no)} members without active)')
conn.close()
