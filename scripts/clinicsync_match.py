import csv
import json
import os
import re
import subprocess
from difflib import SequenceMatcher
from pathlib import Path

CSV_PATH = Path(__file__).resolve().parent.parent / 'tmp_memberships.csv'

TITLE_RE = re.compile(r'^(mr\.?|mrs\.?|ms\.?|dr\.?|miss)\s+', re.IGNORECASE)


def normalize(name: str) -> str:
    if not name:
        return ''
    name = TITLE_RE.sub('', name.strip())
    name = re.sub(r"[^a-zA-Z\s']", '', name)
    name = re.sub(r'\s+', ' ', name).strip().lower()
    return name


def load_sheet_members() -> dict:
    members = {}
    with CSV_PATH.open(newline='') as f:
        reader = csv.reader(f)
        for row in reader:
            if not row or len(row) < 2:
                continue
            if row[0].strip() != 'Granite Mountain Health Clinic':
                continue
            name = row[1].strip()
            status = row[5].strip() if len(row) > 5 else ''
            if not name:
                continue
            norm = normalize(name)
            if not norm:
                continue
            members[norm] = {
                'name': name,
                'status': status,
                'purchase_date': row[2].strip() if len(row) > 2 else '',
                'contract_end': row[6].strip() if len(row) > 6 else ''
            }
    return members


def fetch_clinicsync_rows() -> list:
    inner_sql = """
        SELECT
            raw_payload->>'name' AS name,
            COALESCE(membership_status, '') AS status,
            clinicsync_patient_id
        FROM clinicsync_memberships
        WHERE COALESCE(membership_status, '') <> ''
    """
    sql = f"""COPY ({inner_sql}) TO STDOUT WITH CSV DELIMITER '|' QUOTE '"';"""
    cmd = [
        'psql',
        '-h', 'clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com',
        '-p', '5432',
        '-U', 'clinicadmin',
        '-d', 'postgres',
        '-At',
        '-c', sql
    ]
    env = os.environ.copy()
    env['PGPASSWORD'] = 'or0p5g!JL65cY3Y-l6+V%&RC'
    output = subprocess.check_output(cmd, env=env).decode().strip().split('\\n')
    rows = []
    for line in output:
        if not line:
            continue
        parts = line.split('|')
        if len(parts) != 3:
            continue
        name, status, cid = parts
        norm = normalize(name)
        if not norm:
            continue
        rows.append({'name': name, 'status': status, 'id': cid, 'norm': norm})
    return rows


def main():
    sheet_members = load_sheet_members()
    clinicsync_rows = fetch_clinicsync_rows()
    print(f'Sheet memberships parsed: {len(sheet_members)}')
    print(f'Active ClinicSync memberships: {len(clinicsync_rows)}')

    matches = []
    unmatched_clinicsync = []
    matched_sheet_norms = set()

    for row in clinicsync_rows:
        best = None
        best_score = 0
        for norm, info in sheet_members.items():
            score = SequenceMatcher(None, row['norm'], norm).ratio()
            if score > best_score:
                best_score = score
                best = info
        if best and best_score >= 0.9:
            matches.append({
                'clinicsync_name': row['name'],
                'sheet_name': best['name'],
                'score': round(best_score, 3),
                'status': row['status'],
                'clinicsync_patient_id': row['id']
            })
            matched_sheet_norms.add(normalize(best['name']))
        else:
            unmatched_clinicsync.append(row)

    sheet_only = [
        info for norm, info in sheet_members.items()
        if norm not in matched_sheet_norms
    ]

    print(f'Matches: {len(matches)}')
    print(f'ClinicSync unmatched: {len(unmatched_clinicsync)}')
    print(f'Sheet-only: {len(sheet_only)}')

    report = {
        'matches': matches,
        'unmatched_clinicsync': unmatched_clinicsync,
        'sheet_only': sheet_only
    }
    output_path = Path(__file__).resolve().parent / 'clinicsync_match_report.json'
    with output_path.open('w') as f:
        json.dump(report, f, indent=2)
    print(f'Report saved to {output_path}')


if __name__ == '__main__':
    main()

