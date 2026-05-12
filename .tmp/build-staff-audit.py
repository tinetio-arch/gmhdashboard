#!/usr/bin/env python3
"""
Build ONE consolidated audit CSV for staff with:
  - every active GMH patient
  - Healthie recurring state (active/canceled/paused/none)
  - local activity signals (last dispense, apt, lab)
  - staff_action column (CHASE, VERIFY, DEACTIVATE, EXPECTED, OK)
  - priority 1-5

Source: /tmp/audit-v2-all.csv (already has Healthie state for 403 patients,
no more API calls needed) + local DB for activity signals.
"""
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

rows = list(csv.DictReader(open('/tmp/audit-v2-all.csv')))
print(f'Loaded {len(rows)} patients from audit-v2-all.csv')

conn = psycopg2.connect(**PG)
cur = conn.cursor(cursor_factory=RealDictCursor)

today = date.today()
cutoff_90 = str(today - timedelta(days=90))
cutoff_180 = str(today - timedelta(days=180))

NOW_BRANDS = {'NowMensHealth.Care', 'NowPrimary.Care', 'NOWLongevity.Care'}
JANE_BILLED = {'Jane TCMH $180/Month', 'Jane F&F/FR/Veteran $140/Month'}
QBO_BILLED = {'QBO TCMH $180/Month', 'QBO F&F/FR/Veteran $140/Month'}
LEGACY_BILLED = {'PrimeCare Premier $50/Month', 'PrimeCare Elite $100/Month',
                 'Ins. Supp. $60/Month', 'Approved Disc / Pro-Bono PT'}

out = []
for i, r in enumerate(rows, 1):
    hid = r['healthie_id']
    cur.execute("""
        SELECT patient_id, phone_primary, service_start_date,
               stripe_customer_id, status_key, client_type_key
        FROM patients WHERE healthie_client_id=%s
    """, (hid,))
    p = cur.fetchone()
    if not p:
        continue

    pid = p['patient_id']
    cur.execute("SELECT MAX(dispense_date) d FROM dispenses WHERE patient_id=%s", (pid,))
    ldisp = cur.fetchone()['d']
    cur.execute("SELECT MAX(appointment_time) d FROM appointments WHERE patient_id=%s", (pid,))
    lapt = cur.fetchone()['d']
    cur.execute("SELECT last_lab_date FROM patients WHERE patient_id=%s", (pid,))
    llab = cur.fetchone()['last_lab_date']

    last_disp = str(ldisp).split(' ')[0] if ldisp else ''
    last_apt = str(lapt).split(' ')[0] if lapt else ''
    last_lab = str(llab) if llab else ''
    most_recent = max([last_disp, last_apt, last_lab], default='')

    if most_recent >= cutoff_90:
        recency = 'active_90d'
    elif most_recent >= cutoff_180:
        recency = 'warm'
    elif most_recent:
        recency = 'dormant'
    else:
        recency = 'no_local_activity'

    active_count = int(r['active_count'])
    ptype = r['patient_type']
    ctype = r['client_type']

    # Decide staff action and priority
    # Business goal: find everyone who SHOULD be on Healthie recurring but isn't.
    # Priority 1 = actively receiving care but no Healthie billing (immediate leak)
    # Priority 2 = being billed via QBO (sunsetting) — urgent migrate
    # Priority 3 = being billed via Jane or PrimeCare/Ins legacy — migrate
    # Priority 4 = needs status cleanup
    # Priority 5 = no action needed
    PRO_BONO = {'Approved Disc / Pro-Bono PT'}
    LEGACY_MIGRATE = {'PrimeCare Premier $50/Month', 'PrimeCare Elite $100/Month',
                      'Ins. Supp. $60/Month'}

    if active_count > 0:
        action = 'OK — on active Healthie recurring'
        priority = 5
    elif ptype != 'member':
        action = 'OK — not a member (visit/intermittent)'
        priority = 5
    elif ctype in PRO_BONO:
        action = 'OK — Pro-Bono / Approved Discount (no charge)'
        priority = 5
    elif ctype in NOW_BRANDS:
        # Is member_since recent (new signup)?
        member_since = p['service_start_date']
        is_new_signup = member_since and str(member_since) >= cutoff_90
        if recency == 'active_90d':
            action = 'BILLING GAP — member active but no Healthie recurring (SET UP HEALTHIE)'
            priority = 1
        elif is_new_signup:
            # New member, not enough time to have dispenses/labs yet — highest priority to wire up
            action = 'NEW MEMBER — needs Healthie recurring set up (recently signed up)'
            priority = 1
        elif recency == 'warm':
            action = 'VERIFY — member warming off, confirm status & set up Healthie if active'
            priority = 2
        else:
            action = 'DORMANT — Now*.Care member with no recent activity; verify before deactivating'
            priority = 4
    elif ctype in QBO_BILLED:
        action = 'MIGRATE — billed via QBO (sunsetting) → move to Healthie recurring'
        priority = 2
    elif ctype in JANE_BILLED:
        action = 'MIGRATE — billed via Jane → move to Healthie recurring'
        priority = 3
    elif ctype in LEGACY_MIGRATE:
        action = 'MIGRATE — legacy billing (PrimeCare/InsSupp) → move to Healthie recurring'
        priority = 3
    elif not ctype:
        action = 'DATA-FIX — client_type is blank; set it before billing decision'
        priority = 4
    else:
        action = 'REVIEW — unrecognized client_type'
        priority = 3

    out.append({
        'priority': priority,
        'staff_action': action,
        'healthie_id': hid,
        'full_name': r['full_name'],
        'email': r['email'],
        'phone': p['phone_primary'] or '',
        'patient_type': ptype,
        'client_type': ctype,
        'status_key': p['status_key'] or '',
        'member_since': str(p['service_start_date']) if p['service_start_date'] else '',
        'active_recurring': r['active_pkgs'],
        'active_count': active_count,
        'canceled_count': r['canceled_count'],
        'paused_count': r['paused_count'],
        'last_dispense': last_disp,
        'last_apt': last_apt,
        'last_lab': last_lab,
        'stripe_customer': 'Y' if p['stripe_customer_id'] else '',
        'recency_bucket': recency,
    })

# Sort by priority, then by recency (most recent first within priority)
def recency_rank(r):
    mr = max([r['last_dispense'], r['last_apt'], r['last_lab']], default='')
    return mr
out.sort(key=lambda r: (r['priority'], -int(recency_rank(r).replace('-','') or 0)))

with open('/tmp/staff-audit.csv','w',newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader(); w.writerows(out)

from collections import Counter
by_action = Counter(r['staff_action'] for r in out)
print('\n=== Summary by staff_action ===')
for a, c in sorted(by_action.items(), key=lambda x:(-x[1])):
    print(f'  {c:>4}  {a}')

print(f'\n=== Priority 1 (CHASE) — {sum(1 for r in out if r["priority"]==1)} rows ===')
for r in [x for x in out if x["priority"]==1]:
    print(f'  {r["healthie_id"]:<10} {r["client_type"]:<22} {r["full_name"]:<28} last_disp={r["last_dispense"]} phone={r["phone"]}')

print(f'\nSaved: /tmp/staff-audit.csv  ({len(out)} rows)')
conn.close()
