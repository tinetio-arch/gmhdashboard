#!/usr/bin/env python3
"""
Categorize the 54 Now*.Care-brand members flagged as 'member' but without
an active Healthie recurring package.

Three buckets:
  A) Healthie DUPLICATE — same email exists under a DIFFERENT healthie_id
     that DOES have an active recurring package. Fix: repoint GMH row's
     healthie_client_id to the package-holding account.
  B) CANCELED/PAUSED — user exists in Healthie but recurring was canceled,
     paused, or the user_package_selections row is gone entirely. Fix:
     either flip them off 'member' or manually reactivate billing.
  C) UNKNOWN / OTHER — blank email (can't cross-reference), or no match.
"""
import csv, json

# Load the 126-row output and filter to Now*.Care brands
rows = list(csv.DictReader(open('/tmp/members-without-packages.csv')))
brand_types = {'NowMensHealth.Care', 'NowPrimary.Care', 'NOWLongevity.Care'}
flagged = [r for r in rows if r['client_type'] in brand_types]
print(f'Flagged members (Now*.Care brands): {len(flagged)}', flush=True)

# Load recurring-packages cache
recurring = json.load(open('/tmp/healthie-recurring.json'))
# email -> list of {id, name, packages}
by_email = {}
for u in recurring:
    e = (u.get('email') or '').strip().lower()
    if not e:
        continue
    by_email.setdefault(e, []).append(u)

dupes = []
canceled = []
unknown = []
for r in flagged:
    email = (r['email'] or '').strip().lower()
    hid = r['healthie_id']
    if not email:
        unknown.append({'reason': 'no_email_on_gmh_row', **r})
        continue
    matches = by_email.get(email, [])
    # Match under DIFFERENT healthie_id = duplicate
    dup_match = [m for m in matches if str(m['id']) != str(hid)]
    same_match = [m for m in matches if str(m['id']) == str(hid)]
    if dup_match:
        # There's another Healthie user with the same email that DOES have a package
        dupes.append({**r, 'duplicate_healthie_id': dup_match[0]['id'],
                      'duplicate_has_package': dup_match[0]['packages'][0]['offering_name']})
    elif same_match:
        # Shouldn't happen — if same_id is in recurring they'd have a package
        unknown.append({'reason': 'logic_error', **r})
    else:
        canceled.append(r)

print()
print(f'=== Bucket A: Healthie DUPLICATES ({len(dupes)}) ===')
print('GMH row points at one Healthie ID, but same email has ANOTHER Healthie ID with active package.')
print(f'{"gmh_hid":<10} {"dup_hid":<10} {"name":<28} {"email":<35} {"package"}')
for d in dupes:
    pkg = d['duplicate_has_package'][:50]
    print(f'{d["healthie_id"]:<10} {str(d["duplicate_healthie_id"]):<10} {d["full_name"][:28]:<28} {d["email"][:35]:<35} {pkg}')

print()
print(f'=== Bucket B: NO PACKAGE (canceled/paused/never-had) ({len(canceled)}) ===')
print(f'{"healthie_id":<12} {"brand":<22} {"name":<28} {"email"}')
for c in sorted(canceled, key=lambda x: (x['client_type'], x['full_name'])):
    print(f'{c["healthie_id"]:<12} {c["client_type"]:<22} {c["full_name"][:28]:<28} {c["email"]}')

print()
print(f'=== Bucket C: UNKNOWN ({len(unknown)}) ===')
for u in unknown:
    print(f'  {u.get("reason"):<20} {u["healthie_id"]} {u["full_name"]} (email="{u["email"]}")')

# Save
with open('/tmp/flags-54-investigation.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['bucket', 'gmh_healthie_id', 'full_name', 'email', 'client_type',
                'duplicate_healthie_id', 'duplicate_package'])
    for d in dupes:
        w.writerow(['A_duplicate', d['healthie_id'], d['full_name'], d['email'],
                    d['client_type'], d['duplicate_healthie_id'], d['duplicate_has_package']])
    for c in canceled:
        w.writerow(['B_no_package', c['healthie_id'], c['full_name'], c['email'],
                    c['client_type'], '', ''])
    for u in unknown:
        w.writerow(['C_unknown', u['healthie_id'], u['full_name'], u['email'],
                    u['client_type'], '', u.get('reason', '')])
print(f'\nSaved: /tmp/flags-54-investigation.csv')
