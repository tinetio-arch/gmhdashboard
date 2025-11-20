import csv
from decimal import Decimal, InvalidOperation
from datetime import datetime
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
INPUT_PATH = BASE_DIR / 'tmp_memberships.csv'
OUTPUT_PATH = BASE_DIR / 'jane_packages_clean.csv'

TITLE_REPLACEMENTS = ("mr.", "mrs.", "ms.", "dr.", "miss", "mr", "mrs", "ms", "dr")


def normalize_name(value: str) -> str:
  """
  Lowercase, remove honorifics, collapse whitespace.
  """
  if not value:
    return ''
  name = value.strip()
  lower_name = name.lower()
  for title in TITLE_REPLACEMENTS:
    if lower_name.startswith(title + ' '):
      name = name[len(title) + 1:]
      break
  name = ' '.join(name.split())
  return name.lower()


def parse_decimal(value: str) -> str:
  if not value:
    return ''
  cleaned = value.replace('$', '').replace(',', '').strip()
  if not cleaned:
    return ''
  # Handle parentheses for negatives if they appear
  if cleaned.startswith('(') and cleaned.endswith(')'):
    cleaned = f"-{cleaned[1:-1]}"
  try:
    return str(Decimal(cleaned))
  except InvalidOperation:
    return ''


def parse_date(value: str) -> str:
  if not value:
    return ''
  value = value.strip()
  if not value:
    return ''
  # Handle already ISO formatted strings
  for fmt in ("%B %d, %Y", "%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y"):
    try:
      dt = datetime.strptime(value, fmt)
      return dt.date().isoformat()
    except ValueError:
      continue
  return ''


def parse_sheet():
  rows = []
  if not INPUT_PATH.exists():
    raise FileNotFoundError(f"Input file not found at {INPUT_PATH}")

  with INPUT_PATH.open(newline='') as csvfile:
    reader = csv.reader(csvfile)
    current_category = None  # 'package' or 'membership'
    plan_name = None
    header = None

    for raw_row in reader:
      row = [cell.strip() for cell in raw_row]
      if not any(row):
        header = None
        continue

      first_cell = row[0]

      upper_cell = first_cell.upper()
      if upper_cell.startswith('PACKAGES'):
        current_category = 'package'
        plan_name = None
        header = None
        continue

      if upper_cell.startswith('MEMBERSHIPS'):
        current_category = 'membership'
        plan_name = None
        header = None
        continue

      if (
        first_cell
        and first_cell not in ('Location',)
        and all(not cell for cell in row[1:])
        and first_cell.upper() not in ('PACKAGES', 'MEMBERSHIPS')
      ):
        plan_name = first_cell
        header = None
        continue

      if first_cell == 'Location':
        header = row
        continue

      if not header:
        continue

      data = dict(zip(header, row))
      patient_name = data.get('Patient Name', '').strip()
      if not patient_name:
        continue

      status = (data.get('Status*') or data.get('Status') or '').strip()
      remaining_cycles = (
        data.get('Remaining Billing Cycles*')
        or data.get('Remaining Treatments')
        or ''
      ).strip()
      remaining_cycles_val = parse_decimal(remaining_cycles)
      contract_end = parse_date(data.get('Contract End Date', ''))
      purchase_date = parse_date(
        data.get('Purchase Date*') or data.get('Purchase Date') or ''
      )
      start_date = parse_date(data.get('Start Date', ''))
      outstanding_balance = parse_decimal(data.get('Outstanding Balance', ''))
      last_used = parse_date(data.get('Last Used', ''))
      last_treatment = data.get('Last Treatment', '').strip()
      location = data.get('Location', '').strip()

      rows.append({
        'category': current_category or '',
        'plan_name': plan_name or '',
        'patient_name': patient_name,
        'norm_name': normalize_name(patient_name),
        'status': status,
        'remaining_cycles': remaining_cycles_val,
        'contract_end_date': contract_end,
        'outstanding_balance': outstanding_balance,
        'purchase_date': purchase_date,
        'start_date': start_date,
        'last_treatment': last_treatment,
        'last_used': last_used,
        'location': location
      })

  return rows


def write_clean_csv(rows):
  OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
  with OUTPUT_PATH.open('w', newline='') as csvfile:
    writer = csv.DictWriter(csvfile, fieldnames=[
      'category',
      'plan_name',
      'patient_name',
      'norm_name',
      'status',
      'remaining_cycles',
      'contract_end_date',
      'outstanding_balance',
      'purchase_date',
      'start_date',
      'last_treatment',
      'last_used',
      'location'
    ])
    writer.writeheader()
    writer.writerows(rows)
  print(f"Wrote {len(rows)} rows to {OUTPUT_PATH}")


def main():
  rows = parse_sheet()
  write_clean_csv(rows)


if __name__ == '__main__':
  main()


