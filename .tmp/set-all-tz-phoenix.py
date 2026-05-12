#!/usr/bin/env python3
"""
One-off: Set timezone=America/Phoenix on every GMH-DASHBOARD patient
(local `patients` table rows with a healthie_client_id and active status).

Why: Healthie's practice-level default is Mountain Time (Denver). Patients
created via createClient without explicit timezone silently inherit Denver,
which makes Healthie's built-in reminder engine send appointment times 1
hour off during DST (Denver observes DST, Arizona does not). Clinic is in
AZ, all appointments are in AZ, so all GMH patient profiles should be
America/Phoenix.

Scope:
- Reads GMH patient IDs from /tmp/gmh-healthie-ids.txt (one per line)
- Only touches patients in OUR system — not the 5,000+ Healthie dormant rows
- Skips patients already on America/Phoenix
- Throttled ~3 req/sec (well under Healthie rate limits)
- Writes progress to /tmp/tz-update-log.jsonl after every mutation
- Resumable: re-running skips patients already updated in the log
"""
import os, sys, json, time, urllib.request, urllib.error

API_URL = 'https://api.gethealthie.com/graphql'
API_KEY = os.environ.get('HEALTHIE_API_KEY')
if not API_KEY:
    print('ERROR: HEALTHIE_API_KEY not set'); sys.exit(1)

LOG = '/tmp/tz-update-log.jsonl'
ID_FILE = '/tmp/gmh-healthie-ids.txt'
TARGET_TZ = 'America/Phoenix'
THROTTLE_SEC = 0.33  # ~3 req/sec

def gql(query, variables=None):
    req = urllib.request.Request(API_URL,
        data=json.dumps({'query': query, 'variables': variables or {}}).encode(),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Basic {API_KEY}',
            'AuthorizationSource': 'API',
        })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def fetch_gmh_patients():
    """Fetch GMH patients by ID one at a time (only need id + timezone)."""
    if not os.path.exists(ID_FILE):
        print(f'ERROR: {ID_FILE} missing. Expected one healthie_client_id per line.')
        sys.exit(1)
    with open(ID_FILE) as f:
        ids = [line.strip() for line in f if line.strip()]
    print(f'Loaded {len(ids)} GMH patient Healthie IDs from {ID_FILE}', flush=True)

    users = []
    for i, uid in enumerate(ids, 1):
        q = '''query($id: ID) {
            user(id: $id) { id first_name last_name email timezone active }
        }'''
        try:
            d = gql(q, {'id': uid})
            u = (d.get('data') or {}).get('user')
            if u:
                users.append(u)
            else:
                print(f'  [{i}/{len(ids)}] {uid}: NOT FOUND in Healthie', flush=True)
        except Exception as e:
            print(f'  [{i}/{len(ids)}] {uid}: error {e}', flush=True)
        if i % 50 == 0 or i == len(ids):
            print(f'  [{i}/{len(ids)}] fetched (running total: {len(users)})', flush=True)
        time.sleep(THROTTLE_SEC)
    return users

def load_already_done():
    done = set()
    if not os.path.exists(LOG):
        return done
    with open(LOG) as f:
        for line in f:
            try:
                r = json.loads(line)
                if r.get('status') == 'ok':
                    done.add(str(r['id']))
            except:
                pass
    return done

def update_timezone(user_id):
    q = '''mutation($input: updateClientInput!) {
        updateClient(input: $input) {
            user { id timezone }
            messages { field message }
        }
    }'''
    return gql(q, {'input': {'id': str(user_id), 'timezone': TARGET_TZ}})

def main():
    print('=== Fetching GMH-dashboard patients from Healthie ===', flush=True)
    users = fetch_gmh_patients()
    print(f'Total fetched: {len(users)}', flush=True)

    done = load_already_done()
    print(f'Already updated in previous run: {len(done)}', flush=True)

    to_update = [u for u in users if u.get('timezone') != TARGET_TZ and str(u['id']) not in done]
    print(f'Need update: {len(to_update)}', flush=True)
    print(f'Already Phoenix (skip): {sum(1 for u in users if u.get("timezone") == TARGET_TZ)}', flush=True)

    ok = 0
    fail = 0
    with open(LOG, 'a') as log:
        for i, u in enumerate(to_update, 1):
            uid = str(u['id'])
            name = f'{u.get("first_name","")} {u.get("last_name","")}'.strip()
            old_tz = u.get('timezone') or 'NULL'
            try:
                d = update_timezone(uid)
                msgs = (d.get('data', {}).get('updateClient', {}) or {}).get('messages')
                new_tz = ((d.get('data', {}).get('updateClient', {}) or {}).get('user') or {}).get('timezone')
                if new_tz == TARGET_TZ and not msgs:
                    rec = {'status': 'ok', 'id': uid, 'name': name, 'old_tz': old_tz, 'new_tz': new_tz}
                    ok += 1
                else:
                    rec = {'status': 'fail', 'id': uid, 'name': name, 'old_tz': old_tz, 'new_tz': new_tz, 'messages': msgs, 'raw': d}
                    fail += 1
            except Exception as e:
                rec = {'status': 'error', 'id': uid, 'name': name, 'old_tz': old_tz, 'error': str(e)}
                fail += 1
            log.write(json.dumps(rec) + '\n')
            log.flush()
            if i % 50 == 0 or i == len(to_update):
                print(f'  [{i}/{len(to_update)}] ok={ok} fail={fail}', flush=True)
            time.sleep(THROTTLE_SEC)

    print(f'\n=== DONE ===  updated={ok}  failed={fail}  total_attempted={len(to_update)}', flush=True)
    print(f'Log: {LOG}', flush=True)
    if fail:
        print('Check log for failed records and re-run to retry.', flush=True)

if __name__ == '__main__':
    main()
