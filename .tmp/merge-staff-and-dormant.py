#!/usr/bin/env python3
"""
Merge the deep-dive dormant verification columns onto the main staff audit
so there's ONE document staff can work from.

For the 15 dormant patients, add columns:
  dispenses_ever, healthie_recurring_any_state, healthie_packages_any,
  healthie_recurring_detail, healthie_packages_detail

Everyone else gets blanks in those columns.
"""
import csv

main = list(csv.DictReader(open('/tmp/staff-audit.csv')))
deep = {r['hid']: r for r in csv.DictReader(open('/tmp/dormant-15-verification.csv'))}

extra_cols = [
    'dispenses_ever',
    'last_dispense_ever',
    'first_dispense_ever',
    'healthie_recurring_any_state',
    'healthie_recurring_detail',
    'healthie_packages_any',
    'healthie_packages_detail',
]

out = []
for r in main:
    d = deep.get(r['healthie_id'])
    if d:
        r.update({
            'dispenses_ever': d['disp_ever'],
            'last_dispense_ever': d['last_disp_ever'],
            'first_dispense_ever': d['first_disp_ever'],
            'healthie_recurring_any_state': d['healthie_recurring'],
            'healthie_recurring_detail': d['healthie_rp_details'],
            'healthie_packages_any': d['healthie_packages'],
            'healthie_packages_detail': d['healthie_pkg_details'],
        })
    else:
        for c in extra_cols:
            r[c] = ''
    out.append(r)

# Column order: priority/action first, identity, Healthie state, activity, extras
cols = ['priority','staff_action','healthie_id','full_name','email','phone',
        'patient_type','client_type','status_key','member_since',
        'active_recurring','active_count','canceled_count','paused_count',
        'last_dispense','last_apt','last_lab','stripe_customer','recency_bucket'] + extra_cols

with open('/tmp/staff-audit-final.csv','w',newline='') as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader(); w.writerows(out)

print(f'Wrote {len(out)} rows with {len(cols)} columns')
print(f'  /tmp/staff-audit-final.csv')
