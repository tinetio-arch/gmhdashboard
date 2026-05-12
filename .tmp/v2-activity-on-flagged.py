#!/usr/bin/env python3
"""Activity signals for the CORRECTED 34 Now*.Care flags (from audit-v2)."""
import csv
from datetime import date, timedelta
from dotenv import dotenv_values
import psycopg2
from psycopg2.extras import RealDictCursor

ENV = dotenv_values('/home/ec2-user/gmhdashboard/.env.local')
PG = dict(host=ENV['DATABASE_HOST'], port=int(ENV['DATABASE_PORT']),
          dbname=ENV['DATABASE_NAME'], user=ENV['DATABASE_USER'],
          password=ENV['DATABASE_PASSWORD'],
          sslmode=ENV.get('DATABASE_SSLMODE','require'))

brand = {'NowMensHealth.Care','NowPrimary.Care','NOWLongevity.Care'}
rows = [r for r in csv.DictReader(open('/tmp/audit-v2-members-no-active.csv')) if r['client_type'] in brand]

conn = psycopg2.connect(**PG)
cur = conn.cursor(cursor_factory=RealDictCursor)

out = []
for r in rows:
    hid = r['healthie_id']
    cur.execute("SELECT patient_id, stripe_customer_id, service_start_date FROM patients WHERE healthie_client_id=%s", (hid,))
    p = cur.fetchone()
    if not p: continue
    pid = p['patient_id']
    cur.execute("SELECT MAX(dispense_date) d FROM dispenses WHERE patient_id=%s", (pid,))
    ldisp = cur.fetchone()['d']
    cur.execute("SELECT MAX(appointment_time) d FROM appointments WHERE patient_id=%s", (pid,))
    lapt = cur.fetchone()['d']
    cur.execute("SELECT last_lab_date FROM patients WHERE patient_id=%s", (pid,))
    llab = cur.fetchone()['last_lab_date']
    out.append({**r,
        'last_disp': str(ldisp).split(' ')[0] if ldisp else '',
        'last_apt': str(lapt).split(' ')[0] if lapt else '',
        'last_lab': str(llab) if llab else '',
        'stripe': 'Y' if p['stripe_customer_id'] else '',
        'since': str(p['service_start_date']) if p['service_start_date'] else '',
    })

today = date.today()
cutoff_90 = str(today - timedelta(days=90))
cutoff_180 = str(today - timedelta(days=180))

def bucket(r):
    mr = max([r['last_disp'],r['last_apt'],r['last_lab']], default='')
    if mr >= cutoff_90: return 'active_90'
    if mr >= cutoff_180: return 'warm'
    return 'dormant'

for r in out:
    r['bucket'] = bucket(r)

for b, label in [('active_90','LIKELY REAL LEAKS (activity last 90d)'),
                 ('warm','Warming off (90-180d)'),
                 ('dormant','Dormant (180+d)')]:
    grp = [r for r in out if r['bucket']==b]
    print(f'\n=== {label} ({len(grp)}) ===')
    print(f'{"hid":<10} {"brand":<22} {"name":<28} {"last_disp":<11} {"last_apt":<11} {"last_lab":<11} {"stripe":<7} {"since"}')
    for r in sorted(grp, key=lambda x:(x["client_type"], x["full_name"])):
        print(f'{r["healthie_id"]:<10} {r["client_type"]:<22} {r["full_name"][:28]:<28} '
              f'{r["last_disp"]:<11} {r["last_apt"]:<11} {r["last_lab"]:<11} {r["stripe"]:<7} {r["since"]}')

with open('/tmp/v2-flagged-activity.csv','w',newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader(); w.writerows(out)
print(f'\nSaved: /tmp/v2-flagged-activity.csv  ({len(out)} rows)')
conn.close()
