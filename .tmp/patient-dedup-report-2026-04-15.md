# Patient Dedup & Empty-Row Report — 2026-04-15

**Read-only.** No data was modified. Review findings below; ask Claude to act on anything specific.

- Total patients: **398**
- Flagged (empty or in a duplicate group): **19**
- Empty rows: **1**

## Duplicate groups — same healthie_client_id

_None._

## Duplicate groups — same email

Found **5** groups.

### `amandamarieaustin@yahoo.com`  (2 rows)

**Suggested keeper (most data):** `b3e0b1bd-f86a-4cd5-8f44-e32bbde1b900` — "Andy Austin"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `b3e0b1bd-f86a-4cd5-8f44-e32bbde1b900` | Andy Austin | amandamarieaustin@yahoo.com | +18137437050 | 1976-08-27 | 12182005 | sCWg4dXD1QE62XlyVvCe | member | active | 17 | 2 | 1 | 1 | 0 |
| dup? | `a8f6f8b6-b888-4b0e-8a10-6a75cced2445` | Amanda Austin | amandamarieaustin@yahoo.com | +18137437050 | 1983-07-10 | 12705573 | y4gcxxnqO7VfqFm4kvVH | member | active | 16 | 3 | 1 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`b3e0b1bd-f86a-4cd5-8f44-e32bbde1b900`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - dispenses.patient_id (Dispenses): 1
  - dea_transactions.patient_id (DEA transactions): 1
  - clinicsync_memberships.patient_id (ClinicSync memberships): 1

**`a8f6f8b6-b888-4b0e-8a10-6a75cced2445`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - scribe_sessions.patient_id (Scribe sessions): 1
  - scribe_notes.patient_id (Scribe notes): 2
  - clinicsync_memberships.patient_id (ClinicSync memberships): 1

</details>

### `kristen@bodyandsoulrd.com`  (3 rows)

**Suggested keeper (most data):** `1cc98153-2086-4cfa-9fb8-32925b41205c` — "Kristen Bunger"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `1cc98153-2086-4cfa-9fb8-32925b41205c` | Kristen Bunger | kristen@bodyandsoulrd.com | 6028101756 | 1984-04-17 | 12208881 | I7V8Fn40YykkHFQEJoww | member | active | 16 | 2 | 2 | 1 | 0 |
| dup? | `59d87bb4-dcf0-4319-8b3b-781fbda524f5` | Bennett Bunger | Kristen@bodyandsoulRD.com | (602) 810-1756 | 2018-03-19 | 12765832 | OwufM0YF33SUuLVnz7R3 | member | active | 16 | 0 | 1 | 1 | 0 |
| dup? | `aa26dd87-14bb-4208-b01a-10c66b7f40d4` | Kristen Bunger | Kristen@bodyandsoulRD.com |  | 2019-12-13 | 12745142 | OwufM0YF33SUuLVnz7R3 | member | active | 16 | 0 | 1 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`1cc98153-2086-4cfa-9fb8-32925b41205c`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - payment_transactions.patient_id (Payment transactions): 1
  - scribe_sessions.patient_id (Scribe sessions): 1
  - scribe_notes.patient_id (Scribe notes): 1
  - clinicsync_memberships.patient_id (ClinicSync memberships): 1

**`59d87bb4-dcf0-4319-8b3b-781fbda524f5`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - clinicsync_memberships.patient_id (ClinicSync memberships): 1

**`aa26dd87-14bb-4208-b01a-10c66b7f40d4`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - clinicsync_memberships.patient_id (ClinicSync memberships): 1

</details>

### `azgannonfam@gmail.com`  (3 rows)

**Suggested keeper (most data):** `471ea04b-45a6-4527-9109-31e8b8e06a8a` — "Keira Gannon"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `471ea04b-45a6-4527-9109-31e8b8e06a8a` | Keira Gannon | Azgannonfam@gmail.com | (928) 273-2285 | 1980-07-24 | 12182730 | 8akTGjkoaHS0vjDbPf4w | member | active | 16 | 4 | 8 | 2 | 0 |
| dup? | `17fc56e5-9c07-42c5-b4ff-32e0e1d21502` | Greg Gannon | azgannonfam@gmail.com | 19282732285 | 1980-07-24 | 12746074 | 8akTGjkoaHS0vjDbPf4w | member | active | 16 | 4 | 0 | 1 | 0 |
| dup? | `fa75dcdd-da08-498c-8d67-20807625585b` | Keira Gannon | azgannonfam@gmail.com | 19282733027 | 1985-10-01 | 12746078 | 8akTGjkoaHS0vjDbPf4w | visit | inactive | 14 | 2 | 1 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`471ea04b-45a6-4527-9109-31e8b8e06a8a`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - payment_issues.patient_id (Payment issues): 2
  - quickbooks_sales_receipts.patient_id (QB sales receipts): 5
  - dispenses.patient_id (Dispenses): 2
  - dea_transactions.patient_id (DEA transactions): 2
  - clinicsync_memberships.patient_id (ClinicSync memberships): 1
  - patient_qb_mapping.patient_id (QB customer mapping): 1

**`17fc56e5-9c07-42c5-b4ff-32e0e1d21502`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - dispenses.patient_id (Dispenses): 2
  - dea_transactions.patient_id (DEA transactions): 2

**`fa75dcdd-da08-498c-8d67-20807625585b`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - payment_transactions.patient_id (Payment transactions): 1
  - scribe_sessions.patient_id (Scribe sessions): 1
  - scribe_notes.patient_id (Scribe notes): 1

</details>

### `jrfreeman1983@outlook.com`  (2 rows)

**Suggested keeper (most data):** `c9ca51e6-e404-4709-b774-a9a5b2bf6cd8` — "Janel Freeman"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `c9ca51e6-e404-4709-b774-a9a5b2bf6cd8` | Janel Freeman | jrfreeman1983@outlook.com | +15597991403 | 1957-07-08 | 12745763 | im3muyVAGcUbVLEc07Ej | member | active | 16 | 8 | 8 | 1 | 0 |
| dup? | `16d10988-b2ff-485d-9864-3f257e80a553` | Rich Freeman | jrfreeman1983@outlook.com | +15597991403 | 1955-05-24 | 12745768 | RLzP2OBOTKInNQWEJyYp | member | active | 17 | 4 | 0 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`c9ca51e6-e404-4709-b774-a9a5b2bf6cd8`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - payment_issues.patient_id (Payment issues): 5
  - payment_transactions.patient_id (Payment transactions): 1
  - scribe_sessions.patient_id (Scribe sessions): 1
  - scribe_notes.patient_id (Scribe notes): 1
  - clinicsync_memberships.patient_id (ClinicSync memberships): 2
  - [by healthie_id] patient_metrics.patient_id (Patient metrics (text)): 6

**`16d10988-b2ff-485d-9864-3f257e80a553`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - dispenses.patient_id (Dispenses): 2
  - dea_transactions.patient_id (DEA transactions): 2

</details>

### `keatonlyon2013@gmail.com`  (2 rows)

**Suggested keeper (most data):** `f83511e0-d893-43f5-bd29-56be90f216db` — "Keaton Lyon"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `f83511e0-d893-43f5-bd29-56be90f216db` | Keaton Lyon | keatonlyon2013@gmail.com | 6233134888 |  | 15031801 | ySn3JX73ehPI179rLK6E | member |  | 6 | 16 | 0 | 1 | 0 |
| dup? | `d7f161be-a70a-4d38-9cc0-f75457ed1d89` | Jaren Lyon | keatonlyon2013@gmail.com |  |  | 15031855 | ySn3JX73ehPI179rLK6E | member |  | 5 | 12 | 0 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`f83511e0-d893-43f5-bd29-56be90f216db`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - [by healthie_id] patient_metrics.patient_id (Patient metrics (text)): 16

**`d7f161be-a70a-4d38-9cc0-f75457ed1d89`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - [by healthie_id] patient_metrics.patient_id (Patient metrics (text)): 12

</details>

## Duplicate groups — same phone

Found **5** groups.

### `18137437050`  (2 rows)

**Suggested keeper (most data):** `b3e0b1bd-f86a-4cd5-8f44-e32bbde1b900` — "Andy Austin"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `b3e0b1bd-f86a-4cd5-8f44-e32bbde1b900` | Andy Austin | amandamarieaustin@yahoo.com | +18137437050 | 1976-08-27 | 12182005 | sCWg4dXD1QE62XlyVvCe | member | active | 17 | 2 | 1 | 1 | 0 |
| dup? | `a8f6f8b6-b888-4b0e-8a10-6a75cced2445` | Amanda Austin | amandamarieaustin@yahoo.com | +18137437050 | 1983-07-10 | 12705573 | y4gcxxnqO7VfqFm4kvVH | member | active | 16 | 3 | 1 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`b3e0b1bd-f86a-4cd5-8f44-e32bbde1b900`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - dispenses.patient_id (Dispenses): 1
  - dea_transactions.patient_id (DEA transactions): 1
  - clinicsync_memberships.patient_id (ClinicSync memberships): 1

**`a8f6f8b6-b888-4b0e-8a10-6a75cced2445`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - scribe_sessions.patient_id (Scribe sessions): 1
  - scribe_notes.patient_id (Scribe notes): 2
  - clinicsync_memberships.patient_id (ClinicSync memberships): 1

</details>

### `6028101756`  (2 rows)

**Suggested keeper (most data):** `1cc98153-2086-4cfa-9fb8-32925b41205c` — "Kristen Bunger"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `1cc98153-2086-4cfa-9fb8-32925b41205c` | Kristen Bunger | kristen@bodyandsoulrd.com | 6028101756 | 1984-04-17 | 12208881 | I7V8Fn40YykkHFQEJoww | member | active | 16 | 2 | 2 | 1 | 0 |
| dup? | `59d87bb4-dcf0-4319-8b3b-781fbda524f5` | Bennett Bunger | Kristen@bodyandsoulRD.com | (602) 810-1756 | 2018-03-19 | 12765832 | OwufM0YF33SUuLVnz7R3 | member | active | 16 | 0 | 1 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`1cc98153-2086-4cfa-9fb8-32925b41205c`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - payment_transactions.patient_id (Payment transactions): 1
  - scribe_sessions.patient_id (Scribe sessions): 1
  - scribe_notes.patient_id (Scribe notes): 1
  - clinicsync_memberships.patient_id (ClinicSync memberships): 1

**`59d87bb4-dcf0-4319-8b3b-781fbda524f5`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - clinicsync_memberships.patient_id (ClinicSync memberships): 1

</details>

### `15597991403`  (2 rows)

**Suggested keeper (most data):** `c9ca51e6-e404-4709-b774-a9a5b2bf6cd8` — "Janel Freeman"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `c9ca51e6-e404-4709-b774-a9a5b2bf6cd8` | Janel Freeman | jrfreeman1983@outlook.com | +15597991403 | 1957-07-08 | 12745763 | im3muyVAGcUbVLEc07Ej | member | active | 16 | 8 | 8 | 1 | 0 |
| dup? | `16d10988-b2ff-485d-9864-3f257e80a553` | Rich Freeman | jrfreeman1983@outlook.com | +15597991403 | 1955-05-24 | 12745768 | RLzP2OBOTKInNQWEJyYp | member | active | 17 | 4 | 0 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`c9ca51e6-e404-4709-b774-a9a5b2bf6cd8`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - payment_issues.patient_id (Payment issues): 5
  - payment_transactions.patient_id (Payment transactions): 1
  - scribe_sessions.patient_id (Scribe sessions): 1
  - scribe_notes.patient_id (Scribe notes): 1
  - clinicsync_memberships.patient_id (ClinicSync memberships): 2
  - [by healthie_id] patient_metrics.patient_id (Patient metrics (text)): 6

**`16d10988-b2ff-485d-9864-3f257e80a553`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - dispenses.patient_id (Dispenses): 2
  - dea_transactions.patient_id (DEA transactions): 2

</details>

### `19284584584`  (2 rows)

**Suggested keeper (most data):** `52221564-dc08-4ef6-b685-1b4c410bab5e` — "Sam Breyer"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `52221564-dc08-4ef6-b685-1b4c410bab5e` | Sam Breyer |  | +19284584584 | 1995-09-19 | 12183157 | cKYcaSCrUVyKxggLg6rm | member | active | 16 | 2 | 0 | 1 | 0 |
| dup? | `7313f334-fd41-4670-933e-cbaeb694aef5` | Sam Breyer | sbreyer95@gmail.com | 19284584584 | 1995-09-19 | 12744648 |  | member |  | 11 | 0 | 0 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`52221564-dc08-4ef6-b685-1b4c410bab5e`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - dispenses.patient_id (Dispenses): 1
  - dea_transactions.patient_id (DEA transactions): 1

**`7313f334-fd41-4670-933e-cbaeb694aef5`**
  - healthie_clients.patient_id (Healthie mappings): 1

</details>

### `9288309230`  (2 rows)

**Suggested keeper (most data):** `f9af859d-efbb-42ef-b317-8b59c9657306` — "Reina Metcalf"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `f9af859d-efbb-42ef-b317-8b59c9657306` | Reina Metcalf | reinaharvest@gmail.com | 9288309230 | 1997-10-05 | 12743273 | eyrSmv2IQIwAcYfj5yQA | member | active | 17 | 2 | 0 | 1 | 0 |
| dup? | `283dbdc8-1bdf-4a22-bb6c-a0ce457cc0a8` | Leo Aldorasi | metcalfreina@gmail.com | 9288309230 | 2020-10-13 | 15212207 | UWn22t0R6L5V5q4npQ2r | member |  | 8 | 2 | 0 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`f9af859d-efbb-42ef-b317-8b59c9657306`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - scribe_sessions.patient_id (Scribe sessions): 1
  - scribe_notes.patient_id (Scribe notes): 1

**`283dbdc8-1bdf-4a22-bb6c-a0ce457cc0a8`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - scribe_sessions.patient_id (Scribe sessions): 1
  - scribe_notes.patient_id (Scribe notes): 1

</details>

## Duplicate groups — same name+dob

Found **1** groups.

### `sam breyer|1995-09-19`  (2 rows)

**Suggested keeper (most data):** `52221564-dc08-4ef6-b685-1b4c410bab5e` — "Sam Breyer"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `52221564-dc08-4ef6-b685-1b4c410bab5e` | Sam Breyer |  | +19284584584 | 1995-09-19 | 12183157 | cKYcaSCrUVyKxggLg6rm | member | active | 16 | 2 | 0 | 1 | 0 |
| dup? | `7313f334-fd41-4670-933e-cbaeb694aef5` | Sam Breyer | sbreyer95@gmail.com | 19284584584 | 1995-09-19 | 12744648 |  | member |  | 11 | 0 | 0 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`52221564-dc08-4ef6-b685-1b4c410bab5e`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - dispenses.patient_id (Dispenses): 1
  - dea_transactions.patient_id (DEA transactions): 1

**`7313f334-fd41-4670-933e-cbaeb694aef5`**
  - healthie_clients.patient_id (Healthie mappings): 1

</details>

## Duplicate groups — same ghl_contact_id

Found **4** groups.

### `OwufM0YF33SUuLVnz7R3`  (2 rows)

**Suggested keeper (most data):** `59d87bb4-dcf0-4319-8b3b-781fbda524f5` — "Bennett Bunger"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `59d87bb4-dcf0-4319-8b3b-781fbda524f5` | Bennett Bunger | Kristen@bodyandsoulRD.com | (602) 810-1756 | 2018-03-19 | 12765832 | OwufM0YF33SUuLVnz7R3 | member | active | 16 | 0 | 1 | 1 | 0 |
| dup? | `aa26dd87-14bb-4208-b01a-10c66b7f40d4` | Kristen Bunger | Kristen@bodyandsoulRD.com |  | 2019-12-13 | 12745142 | OwufM0YF33SUuLVnz7R3 | member | active | 16 | 0 | 1 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`59d87bb4-dcf0-4319-8b3b-781fbda524f5`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - clinicsync_memberships.patient_id (ClinicSync memberships): 1

**`aa26dd87-14bb-4208-b01a-10c66b7f40d4`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - clinicsync_memberships.patient_id (ClinicSync memberships): 1

</details>

### `8akTGjkoaHS0vjDbPf4w`  (3 rows)

**Suggested keeper (most data):** `471ea04b-45a6-4527-9109-31e8b8e06a8a` — "Keira Gannon"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `471ea04b-45a6-4527-9109-31e8b8e06a8a` | Keira Gannon | Azgannonfam@gmail.com | (928) 273-2285 | 1980-07-24 | 12182730 | 8akTGjkoaHS0vjDbPf4w | member | active | 16 | 4 | 8 | 2 | 0 |
| dup? | `17fc56e5-9c07-42c5-b4ff-32e0e1d21502` | Greg Gannon | azgannonfam@gmail.com | 19282732285 | 1980-07-24 | 12746074 | 8akTGjkoaHS0vjDbPf4w | member | active | 16 | 4 | 0 | 1 | 0 |
| dup? | `fa75dcdd-da08-498c-8d67-20807625585b` | Keira Gannon | azgannonfam@gmail.com | 19282733027 | 1985-10-01 | 12746078 | 8akTGjkoaHS0vjDbPf4w | visit | inactive | 14 | 2 | 1 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`471ea04b-45a6-4527-9109-31e8b8e06a8a`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - payment_issues.patient_id (Payment issues): 2
  - quickbooks_sales_receipts.patient_id (QB sales receipts): 5
  - dispenses.patient_id (Dispenses): 2
  - dea_transactions.patient_id (DEA transactions): 2
  - clinicsync_memberships.patient_id (ClinicSync memberships): 1
  - patient_qb_mapping.patient_id (QB customer mapping): 1

**`17fc56e5-9c07-42c5-b4ff-32e0e1d21502`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - dispenses.patient_id (Dispenses): 2
  - dea_transactions.patient_id (DEA transactions): 2

**`fa75dcdd-da08-498c-8d67-20807625585b`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - payment_transactions.patient_id (Payment transactions): 1
  - scribe_sessions.patient_id (Scribe sessions): 1
  - scribe_notes.patient_id (Scribe notes): 1

</details>

### `RXGueSwZbP3Z9yCLDUnV`  (2 rows)

**Suggested keeper (most data):** `471f488b-d771-462b-ad91-08ff442bd354` — "Milfred Tewawina"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `471f488b-d771-462b-ad91-08ff442bd354` | Milfred Tewawina | mtewawina928@icloud.com | (928) 451-0311 | 1991-01-29 | 12164313 | RXGueSwZbP3Z9yCLDUnV | member | active | 16 | 7 | 9 | 2 | 0 |
| dup? | `1ba02763-fba0-4ecd-9852-43adb27890a1` | Brad Odom |  | +19284510311 | 1987-05-26 | 12715916 | RXGueSwZbP3Z9yCLDUnV | member | active_pending | 16 | 4 | 0 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`471f488b-d771-462b-ad91-08ff442bd354`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - payment_issues.patient_id (Payment issues): 1
  - quickbooks_sales_receipts.patient_id (QB sales receipts): 8
  - ups_shipments.patient_id (UPS shipments): 1
  - dispenses.patient_id (Dispenses): 3
  - dea_transactions.patient_id (DEA transactions): 3
  - patient_qb_mapping.patient_id (QB customer mapping): 1

**`1ba02763-fba0-4ecd-9852-43adb27890a1`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - dispenses.patient_id (Dispenses): 2
  - dea_transactions.patient_id (DEA transactions): 2

</details>

### `ySn3JX73ehPI179rLK6E`  (2 rows)

**Suggested keeper (most data):** `f83511e0-d893-43f5-bd29-56be90f216db` — "Keaton Lyon"

| role | patient_id | name | email | phone | dob | healthie_id | ghl_id | type | status | populated_fields | clinical | payment | external | meta |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **KEEP?** | `f83511e0-d893-43f5-bd29-56be90f216db` | Keaton Lyon | keatonlyon2013@gmail.com | 6233134888 |  | 15031801 | ySn3JX73ehPI179rLK6E | member |  | 6 | 16 | 0 | 1 | 0 |
| dup? | `d7f161be-a70a-4d38-9cc0-f75457ed1d89` | Jaren Lyon | keatonlyon2013@gmail.com |  |  | 15031855 | ySn3JX73ehPI179rLK6E | member |  | 5 | 12 | 0 | 1 | 0 |

<details><summary>Per-row dependent-data inventory</summary>

**`f83511e0-d893-43f5-bd29-56be90f216db`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - [by healthie_id] patient_metrics.patient_id (Patient metrics (text)): 16

**`d7f161be-a70a-4d38-9cc0-f75457ed1d89`**
  - healthie_clients.patient_id (Healthie mappings): 1
  - [by healthie_id] patient_metrics.patient_id (Patient metrics (text)): 12

</details>

## Empty rows (no name, or no contact info at all)

| patient_id | name | email | phone | healthie_id | ghl_id | date_added | populated_fields | dep_rows_total |
|---|---|---|---|---|---|---|---|---|
| `18b1e8af-fd3c-44ad-b86b-3747d4fb6c4a` | Bill Griffith |  |  |  |  | Sat Oct 18 2025 21:32:56 GMT-0700 (Mountain Standard Time) | 6 | 4 |
