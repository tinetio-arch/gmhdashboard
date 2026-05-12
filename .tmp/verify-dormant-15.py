#!/usr/bin/env python3
"""
Deep verification of 15 dormant Now*.Care members. For each:
  - ALL-TIME dispense count + last dispense (not capped at 180d)
  - userPackageSelections (one-off packages)
  - recurringPayments across active/canceled/paused
  - stripe_customer_id presence

Goal: determine if they SHOULD be on a Healthie recurring and aren't, or if
they're truly churned, or if they're on a package I missed.
"""
import json, time, csv
from dotenv import dotenv_values
import urllib.request
import psycopg2
from psycopg2.extras import RealDictCursor

ENV = dotenv_values('/home/ec2-user/gmhdashboard/.env.local')
PG = dict(host=ENV['DATABASE_HOST'], port=int(ENV['DATABASE_PORT']),
          dbname=ENV['DATABASE_NAME'], user=ENV['DATABASE_USER'],
          password=ENV['DATABASE_PASSWORD'],
          sslmode=ENV.get('DATABASE_SSLMODE','require'))
API = 'https://api.gethealthie.com/graphql'
KEY = ENV['HEALTHIE_API_KEY']

def gql(q, v=None):
    req = urllib.request.Request(API,
        data=json.dumps({'query':q,'variables':v or {}}).encode(),
        headers={'Content-Type':'application/json','Authorization':f'Basic {KEY}','AuthorizationSource':'API'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

# Pull the 15 dormant from the staff audit
rows = [r for r in csv.DictReader(open('/tmp/staff-audit.csv')) if 'DORMANT' in r['staff_action']]
print(f'Verifying {len(rows)} dormant patients\n', flush=True)

conn = psycopg2.connect(**PG)
cur = conn.cursor(cursor_factory=RealDictCursor)

Q_RP = '''query($uid: ID) { recurringPayments(user_id: $uid) {
    id offering_name original_price is_canceled is_paused next_payment_date canceled_at paused_at start_at } }'''
Q_UPS = '''query($uid: ID) { userPackageSelections(user_id: $uid) {
    id offering { name price } recurring_payment { id is_canceled is_paused next_payment_date } } }'''
Q_BILL = '''query($uid: ID) { billingItems(client_id: $uid, page_size: 20) {
    id created_at amount_paid status display_name } }'''

results = []
for r in rows:
    hid = r['healthie_id']
    cur.execute("SELECT patient_id, stripe_customer_id FROM patients WHERE healthie_client_id=%s", (hid,))
    p = cur.fetchone()
    pid = p['patient_id']

    # All-time dispenses
    cur.execute("SELECT COUNT(*) c, MAX(dispense_date) d, MIN(dispense_date) f FROM dispenses WHERE patient_id=%s", (pid,))
    disp = cur.fetchone()

    # All-time appointments
    cur.execute("SELECT COUNT(*) c FROM appointments WHERE patient_id=%s", (pid,))
    apts = cur.fetchone()['c']

    # Healthie recurring (all states)
    try:
        rp_all = (gql(Q_RP, {'uid': hid}).get('data') or {}).get('recurringPayments') or []
    except Exception as e:
        rp_all = []
    time.sleep(0.5)

    # Healthie package selections
    try:
        ups = (gql(Q_UPS, {'uid': hid}).get('data') or {}).get('userPackageSelections') or []
    except Exception as e:
        ups = []
    time.sleep(0.5)

    # Healthie billing items (last 20, any kind)
    try:
        bi = (gql(Q_BILL, {'uid': hid}).get('data') or {}).get('billingItems') or []
    except Exception as e:
        bi = []
    time.sleep(0.5)

    row = {
        'hid': hid,
        'name': r['full_name'],
        'brand': r['client_type'],
        'since': r['member_since'],
        'disp_ever': disp['c'],
        'last_disp_ever': str(disp['d']).split(' ')[0] if disp['d'] else '',
        'first_disp_ever': str(disp['f']).split(' ')[0] if disp['f'] else '',
        'apts_ever': apts,
        'stripe': 'Y' if p['stripe_customer_id'] else '',
        'healthie_recurring': len(rp_all),
        'healthie_rp_details': '; '.join(f'{x["offering_name"][:30]}|cx={x["is_canceled"]}|pz={x["is_paused"]}|next={x["next_payment_date"]}|start={x["start_at"]}' for x in rp_all),
        'healthie_packages': len(ups),
        'healthie_pkg_details': '; '.join(f'{u["offering"]["name"]}|${u["offering"]["price"]}' for u in ups),
        'recent_billing_items': len(bi),
    }
    results.append(row)

    # Print compact summary
    print(f'{hid} {r["full_name"][:28]:<28} disp={disp["c"]:>3} last={row["last_disp_ever"] or "-":<11} hRP={len(rp_all)} hUPS={len(ups)} bill={len(bi)} stripe={row["stripe"]}')
    if rp_all:
        for x in rp_all:
            print(f'    RP: {x["offering_name"]} cx={x["is_canceled"]} pz={x["is_paused"]} next={x["next_payment_date"]} canceled_at={x.get("canceled_at")}')
    if ups:
        for u in ups:
            print(f'    PKG: {u["offering"]["name"]} ${u["offering"]["price"]}')
    if bi:
        last_bi = bi[0]
        print(f'    Last billing item: {last_bi.get("display_name")} ${last_bi.get("amount_paid")} status={last_bi.get("status")} {last_bi.get("created_at")}')

with open('/tmp/dormant-15-verification.csv','w',newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(results[0].keys()))
    w.writeheader(); w.writerows(results)
print(f'\nSaved: /tmp/dormant-15-verification.csv')
conn.close()
