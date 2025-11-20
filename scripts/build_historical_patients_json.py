import csv
import json
from pathlib import Path
from collections import defaultdict

BASE_DIR = Path(__file__).resolve().parents[1]
CSV_PATH = BASE_DIR / 'data' / 'jane_patient_directory.csv'
OUTPUT_PATH = BASE_DIR / 'data' / 'historical_patients.json'

PREFIXES = (
    'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'miss', 'dr', 'dr.', 'prof', 'prof.',
    'sir', 'madam', 'rev', 'rev.', 'fr', 'fr.'
)

def strip_prefix(name: str) -> str:
    if not name:
        return ''
    tokens = name.strip().split()
    while tokens and tokens[0].lower().strip('.') in PREFIXES:
        tokens = tokens[1:]
    return ' '.join(tokens).strip()

def normalize(name: str) -> str:
    return ' '.join(strip_prefix(name).lower().split())

def main():
    directory = {}
    with CSV_PATH.open(newline='') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            first = row.get('First Name', '').strip()
            last = row.get('Last Name', '').strip()
            preferred = row.get('Preferred Name', '').strip()
            full_name = ' '.join(filter(None, [preferred or first, last])).strip() or row.get('Patient Number', '')
            normalized_name = normalize(full_name)
            if not normalized_name:
                continue
            entry = {
                'full_name': strip_prefix(full_name) or full_name,
                'first_name': strip_prefix(preferred or first or ''),
                'last_name': last,
                'email': row.get('Email', '').strip() or None,
                'mobile_phone': row.get('Mobile Phone', '').strip() or None,
                'home_phone': row.get('Home Phone', '').strip() or None,
                'street': row.get('Street Address', '').strip() or None,
                'street2': row.get('Street Address 2', '').strip() or None,
                'city': row.get('City', '').strip() or None,
                'state': row.get('Province', '').strip() or None,
                'postal': row.get('Postal', '').strip() or None,
                'country': row.get('Country', '').strip() or None,
                'birth_date': row.get('Birth Date', '').strip() or None,
                'sex': row.get('Sex', '').strip() or None,
                'member_since': row.get('Member Since', '').strip() or None,
                'patient_number': row.get('Patient Number', '').strip() or None
            }
            directory.setdefault(normalized_name, entry)
    OUTPUT_PATH.write_text(json.dumps(directory, indent=2, sort_keys=True))
    print(f"Wrote {len(directory)} rows to {OUTPUT_PATH}")

if __name__ == '__main__':
    main()
