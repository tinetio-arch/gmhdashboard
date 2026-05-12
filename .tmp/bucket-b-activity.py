#!/usr/bin/env python3
"""
Local-DB activity signals for Bucket B — 49 Now*.Care members without an
active Healthie recurring package. No Healthie API calls.

Signals per patient:
  - service_start_date (when membership began)
  - last dispense date (testosterone or any drug)
  - appointment count + last appt date
  - stripe_customer_id present (billed via Stripe subscription maybe?)
  - last_lab_date (clinical activity)
"""
import csv
from dotenv import dotenv_values
import psycopg2
from psycopg2.extras import RealDictCursor

ENV = dotenv_values('/home/ec2-user/gmhdashboard/.env.local')
PG = dict(host=ENV['DATABASE_HOST'], port=int(ENV['DATABASE_PORT']),
          dbname=ENV['DATABASE_NAME'], user=ENV['DATABASE_USER'],
          password=ENV['DATABASE_PASSWORD'],
          sslmode=ENV.get('DATABASE_SSLMODE', 'require'))

# Read flagged Bucket B + C rows from investigation CSV
flagged = []
for r in csv.DictReader(open('/tmp/flags-54-investigation.csv')):
    if r['bucket'] in ('B_no_package', 'C_unknown'):
        flagged.append(r)
# Also add Janel (moved from A to B after duplicate-check)
flagged.append({'bucket':'B_no_package','gmh_healthie_id':'12745763',
                'full_name':'Janel Freeman','email':'jrfreeman1983@outlook.com',
                'client_type':'NowPrimary.Care'})
print(f'Auditing {len(flagged)} flagged members', flush=True)

conn = psycopg2.connect(**PG)
cur = conn.cursor(cursor_factory=RealDictCursor)

results = []
for f in flagged:
    hid = f['gmh_healthie_id']
    cur.execute("""
        SELECT patient_id, full_name, service_start_date, last_lab_date,
               stripe_customer_id, ghl_contact_id, status_key, created_at,
               client_type
        FROM patients WHERE healthie_client_id=%s
    """, (hid,))
    p = cur.fetchone()
    if not p:
        continue
    pid = p['patient_id']

    cur.execute("SELECT COUNT(*) c, MAX(dispense_date) last FROM dispenses WHERE patient_id=%s", (pid,))
    d = cur.fetchone()
    cur.execute("SELECT COUNT(*) c, MAX(appointment_time) last FROM appointments WHERE patient_id=%s", (pid,))
    a = cur.fetchone()

    results.append({
        'hid': hid,
        'name': p['full_name'],
        'brand': p['client_type'],
        'member_since': str(p['service_start_date']) if p['service_start_date'] else '',
        'created_at': str(p['created_at'].date()) if p['created_at'] else '',
        'last_lab': str(p['last_lab_date']) if p['last_lab_date'] else '',
        'disp_cnt': d['c'],
        'last_disp': str(d['last']).split(' ')[0] if d['last'] else '',
        'apt_cnt': a['c'],
        'last_apt': str(a['last']).split(' ')[0] if a['last'] else '',
        'stripe_cust': 'Y' if p['stripe_customer_id'] else '',
        'ghl': 'Y' if p['ghl_contact_id'] else '',
    })

# Sort: most recently active first
def sortkey(r):
    return max([r['last_disp'] or '', r['last_apt'] or '', r['last_lab'] or ''], default='')
results.sort(key=sortkey, reverse=True)

# Categorize by activity recency
from datetime import date, timedelta
today = date.today()
cutoff_90 = str(today - timedelta(days=90))
cutoff_180 = str(today - timedelta(days=180))

active_90 = []
active_180 = []
dormant = []
for r in results:
    most_recent = max([r['last_disp'] or '', r['last_apt'] or '', r['last_lab'] or ''], default='')
    if most_recent >= cutoff_90:
        active_90.append(r)
    elif most_recent >= cutoff_180:
        active_180.append(r)
    else:
        dormant.append(r)

def pr(title, group):
    print(f'\n=== {title} ({len(group)}) ===')
    print(f'{"hid":<10} {"name":<28} {"brand":<20} {"last_disp":<11} {"last_apt":<11} {"last_lab":<11} {"stripe":<7} {"since"}')
    for r in group:
        print(f'{r["hid"]:<10} {r["name"][:28]:<28} {r["brand"][:20]:<20} '
              f'{r["last_disp"]:<11} {r["last_apt"]:<11} {r["last_lab"]:<11} {r["stripe_cust"]:<7} {r["member_since"]}')

pr('LIKELY REAL BILLING GAPS — activity in last 90 days', active_90)
pr('Warming off — last activity 90-180 days', active_180)
pr('Dormant / likely churned — no activity in 180+ days', dormant)

# Save full CSV
with open('/tmp/bucket-b-activity.csv', 'w', newline='') as f:
    if results:
        w = csv.DictWriter(f, fieldnames=list(results[0].keys()))
        w.writeheader()
        w.writerows(results)
print(f'\nSaved: /tmp/bucket-b-activity.csv')
conn.close()
