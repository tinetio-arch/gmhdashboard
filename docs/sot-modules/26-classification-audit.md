---
name: Patient Classification Audit v3 (Healthie appointment types)
description: Dry-run audit using Healthie appointment_type.name as primary signal. Scope: 37 Unclassified patients only. NO DATA WRITTEN.
type: report
---

# Patient Classification Audit v3 — 2026-04-16T23:50:27.476Z

**Total patients in DB:** 401
**Currently Unclassified (scope for proposals):** 37
**Duplicate groups:** 10
**Orphan Healthie links:** 3
**Hard flags (female + TRT dispenses):** 0

> **What changed from v2:** appointment_type.name from Healthie is now the primary classification signal (per Phil 2026-04-16). GHL tags are ignored. Patients without clear appointment signals stay in the Unclassified tab for manual review.

## 0. Confirmed Action Items (Phil 2026-04-16)

| Patient | Confirmed Action |
|---|---|
| Jaren Lyon | Dependent of Keaton Lyon — set `parent_patient_id` |
| Sam Breyer (2 rows) | Keep `52221564-…` (2 dispenses); merge `7313f334-…` into it |
| Keira Gannon | Spouse of Greg; her 2 dispenses are misattributions → reassign to Greg (§7.6) |
| Greg & Keira Gannon | Split GHL contact `8akTGjkoaHS0vjDbPf4w`; set `spouse_patient_id` |
| Brad Odom ↔ Milfred Tewawina | Split shared GHL contact `RXGueSwZbP3Z9yCLDUnV`; separate charts stay |
| Bennett Bunger | Dependent of Kristen Bunger — set `parent_patient_id` |
| Danny Fradenburg | Gender corrected to Male (done 2026-04-16) |

## 1. Hard Flags (Female + TRT dispense)

_None. Clear._

## 2. Duplicate Candidates

| # | Match | Patients |
|---|---|---|
| 1 | email `keatonlyon2013@gmail.com` | **Jaren Lyon** (`d7f161be`, disp:0, gender:?) vs. **Keaton Lyon** (`f83511e0`, disp:0, gender:?) |
| 2 | phone `19284584584` | **Sam Breyer** (`7313f334`, disp:0, gender:M) vs. **Sam Breyer** (`52221564`, disp:2, gender:M) |
| 3 | phone `19282732285` | **Greg Gannon** (`17fc56e5`, disp:2, gender:M) vs. **Keira Gannon** (`471ea04b`, disp:2, gender:?) |
| 4 | phone `19284510311` | **Brad Odom** (`1ba02763`, disp:2, gender:M) vs. **Milfred Tewawina** (`471f488b`, disp:3, gender:?) |
| 5 | ghl `cKYcaSCrUVyKxggLg6rm` | **Sam Breyer** (`7313f334`, disp:0, gender:M) vs. **Sam Breyer** (`52221564`, disp:2, gender:M) |
| 6 | ghl `8akTGjkoaHS0vjDbPf4w` | **Greg Gannon** (`17fc56e5`, disp:2, gender:M) vs. **Keira Gannon** (`471ea04b`, disp:2, gender:?) vs. **Keira Gannon** (`fa75dcdd`, disp:0, gender:F) |
| 7 | ghl `ySn3JX73ehPI179rLK6E` | **Jaren Lyon** (`d7f161be`, disp:0, gender:?) vs. **Keaton Lyon** (`f83511e0`, disp:0, gender:?) |
| 8 | ghl `RXGueSwZbP3Z9yCLDUnV` | **Brad Odom** (`1ba02763`, disp:2, gender:M) vs. **Milfred Tewawina** (`471f488b`, disp:3, gender:?) |
| 9 | ghl `OwufM0YF33SUuLVnz7R3` | **Kristen Bunger** (`aa26dd87`, disp:0, gender:F) vs. **Bennett Bunger** (`59d87bb4`, disp:0, gender:?) |
| 10 | name+dob `sam breyer|Tue Sep 19` | **Sam Breyer** (`7313f334`, disp:0, gender:M) vs. **Sam Breyer** (`52221564`, disp:2, gender:M) |

## 3. Orphan Healthie Links

| Patient | Email | Healthie ID | Gender |
|---|---|---|---|
| Joe Karcie | joekarcie@gmail.com | `14144143` | ? |
| Mason Guy Clegg | turbotechtampa@gmail.com | `14773241` | ? |
| Taylor Osborne | taylor84osborne@gmail.com | `15023802` | ? |

## 4. Proposed Classification — Unclassified (37)

**Signal source:** Healthie `appointment_type.name`. Each proposal shows the exact appointment type(s) that triggered it. Patients with no appointments, errors, or unmatched types → stay Unclassified for staff review.

**Confidence:** 🟢 HIGH = clear clinical appointment type match. 🟡 MEDIUM = partial or inferred. 🔴 LOW/NONE = no signal.

| Patient | Gender | Appt Count | Proposed Group | Service Tags | Conf | Evidence | Known Case |
|---|---|---|---|---|---|---|---|
| Jacob Baker | ? | 2 | NOWMensHealth.Care | — | 🟢 | matched: Initial Male Hormone Replacement Consult  •  unmatched: Lab Review - Telehealth |  |
| Karla Shafer | ? | 2 | NOWLongevity.Care | — | 🟢 | matched: Initial Female Hormone Replacement Therapy Consult \| Initial Primary Care Consult - Physical & Lab Review |  |
| Clint Shafer | M | 14 | NOWMensHealth.Care | pelleting | 🟢 | matched: EvexiPel Repeat Pelleting Procedure Male  •  unmatched: Migrated Appointment |  |
| Sam Breyer | M | 6 | NOWMensHealth.Care | — | 🟢 | matched: Male HRT Follow-Up  •  unmatched: Migrated Appointment \| 5 Week Lab Draw | **Merge INTO 52221564 (has 2 dispenses)** |
| David Bandy | M | 5 | _Unclassified_ | — | ⚪ | unmatched: Migrated Appointment \| Allergy Injection Consult |  |
| Alana Morrison | ? | 1 | Sick Visit | — | 🟡 | matched: In-Person Sick Visit |  |
| Christie Balow | F | 4 | NOWPrimary.Care | pelleting | 🟢 | matched: Initial Primary Care Consult - Physical & Lab Review \| EvexiPel Repeat Pelleting Procedure Female  •  unmatched: 5 Week Lab Draw \| Lab Review - Telehealth |  |
| Leo Aldorasi | ? | 3 | Sick Visit | — | 🟡 | matched: In-Person Sick Visit  •  unmatched: 90 Day Lab Draw |  |
| Annette Peterson | F | 7 | NOWLongevity.Care | pelleting | 🟢 | matched: EvexiPel Repeat Pelleting Procedure Female  •  unmatched: Migrated Appointment \| 5 Week Lab Draw |  |
| Kelley McGuire Jones | F | 10 | NOWLongevity.Care | pelleting | 🟢 | matched: EvexiPel Repeat Pelleting Procedure Female  •  unmatched: Migrated Appointment |  |
| Sara Saloner | F | 16 | NOWLongevity.Care | pelleting | 🟢 | matched: EvexiPel Repeat Pelleting Procedure Female  •  unmatched: Migrated Appointment |  |
| Barbara Barone | ? | 1 | Sick Visit | — | 🟡 | matched: In-Person Sick Visit |  |
| Brantley Ross | M | 5 | Sick Visit | — | 🟡 | matched: In-Person Sick Visit  •  unmatched: Migrated Appointment |  |
| Heidi Womble | F | 14 | NOWLongevity.Care | pelleting | 🟢 | matched: EvexiPel Repeat Pelleting Procedure Female  •  unmatched: Migrated Appointment |  |
| Rachelle Hershey | F | 24 | NOWLongevity.Care | pelleting | 🟢 | matched: EvexiPel Repeat Pelleting Procedure Female  •  unmatched: Migrated Appointment |  |
| Susan Krause | F | 15 | _Unclassified_ | weight-loss,peptides | 🔴 | matched: Weight Loss Consult \| NMH Peptide Education & Pickup  •  unmatched: Migrated Appointment |  |
| Stephanie Yocham | F | 17 | NOWLongevity.Care | pelleting | 🟢 | matched: EvexiPel Repeat Pelleting Procedure Female  •  unmatched: Migrated Appointment \| 5 Week Lab Draw |  |
| Heather Ramirez | F | 45 | _Unclassified_ | — | ⚪ | unmatched: Migrated Appointment \| Injection |  |
| Patricia Brown | F | 6 | NOWLongevity.Care | pelleting | 🟢 | matched: EvexiPel Repeat Pelleting Procedure Female  •  unmatched: Migrated Appointment |  |
| Caleb Work | ? | 1 | NOWMensHealth.Care | — | 🟢 | matched: Initial Male Hormone Replacement Consult |  |
| Jill Fulmer | F | 23 | NOWLongevity.Care | peptides,pelleting | 🟢 | matched: NMH Peptide Education & Pickup \| EvexiPel Repeat Pelleting Procedure Female  •  unmatched: Migrated Appointment \| 5 Week Lab Draw \| Annual Lab Review - Telehealth |  |
| Tony Meckaroski | ? | 1 | Sick Visit | — | 🟡 | matched: Telemedicine Sick Consult |  |
| Brandy campbell | F | 3 | NOWLongevity.Care | pelleting | 🟢 | matched: EvexiPel Initial Pelleting Procedure Female \| Initial Female Hormone Replacement Therapy Consult  •  unmatched: Lab Review - Telehealth |  |
| Jesus Cris Acosta Acosta | ? | 1 | _Unclassified_ | peptides | 🔴 | matched: NMH Peptide Education & Pickup |  |
| Susan Crane | F | 10 | _Unclassified_ | weight-loss | 🔴 | matched: Weight Loss Education & Measurements \| Weight Loss Consult  •  unmatched: Migrated Appointment |  |
| Marla Tubbs | F | 2 | NOWLongevity.Care | — | 🟢 | matched: Initial Female Hormone Replacement Therapy Consult \| Initial Primary Care Consult - Physical & Lab Review |  |
| Jessica Porter | F | 5 | NOWLongevity.Care | pelleting | 🟢 | matched: Initial Female Hormone Replacement Therapy Consult \| EvexiPel Initial Pelleting Procedure Female \| EvexiPel Repeat Pelleting Procedure Female  •  unmatched: 5 Week Lab Draw \| Lab Review - Telehealth |  |
| Jaren Lyon | ? | 1 | Sick Visit | — | 🟡 | matched: In-Person Sick Visit | **Dependent of Keaton Lyon → set parent_patient_id** |
| Stephanie O'Deay | ? | 2 | NOWPrimary.Care | — | 🟢 | matched: Premier Membership Initial Primary Care Consult \| Initial Primary Care Consult - Physical & Lab Review |  |
| Elizabeth Douglas | F | 3 | NOWPrimary.Care | — | 🟢 | matched: PC Follow-Up - Telehealth  •  unmatched: Migrated Appointment |  |
| Keaton Lyon | ? | 1 | Sick Visit | — | 🟡 | matched: In-Person Sick Visit |  |
| Jessica Leick | ? | 1 | _Unclassified_ | — | ⚪ | unmatched: Allergy Injection Consult |  |
| Zoe Jacobson | ? | 3 | Sick Visit | — | 🟡 | matched: In-Person Sick Visit |  |
| Keira Gannon | F | 9 | NOWLongevity.Care | pelleting | 🟢 | matched: EvexiPel Repeat Pelleting Procedure Female  •  unmatched: Migrated Appointment | **Likely dup of the other Keira; decide keeper, merge** |
| Paul Peterson | ? | 1 | _Unclassified_ | — | ⚪ | unmatched: Allergy Injection Consult |  |
| Melody Smith | F | 6 | NOWLongevity.Care | pelleting | 🟢 | matched: Initial Female Hormone Replacement Therapy Consult \| EvexiPel Repeat Pelleting Procedure Female \| EvexiPel Initial Pelleting Procedure Female  •  unmatched: Migrated Appointment \| 5 Week Lab Draw |  |
| Lisa Howe | F | 10 | NOWLongevity.Care | pelleting | 🟢 | matched: EvexiPel Repeat Pelleting Procedure Female  •  unmatched: Migrated Appointment |  |

### Summary
- **High-signal classifications (ready to apply):** 30
- **No appointments or no matching type (→ manual queue):** 7

## 5. Classified Patients — Reference Only (364)

<details><summary>Expand</summary>

| Patient | Gender | Type | Client Type | Group/Clinic |
|---|---|---|---|---|
| Ben Abt | M | member | NowMensHealth.Care | — |
| Ellis Holliday | M | member | NowMensHealth.Care | — |
| Jay Sebring | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Greg Gannon | M | member | NowMensHealth.Care | — |
| Jay Tubbs | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Kevin Raybon | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Taylor Osborne | ? | visit | NowMensHealth.Care | nowmenshealth.care |
| Mason Guy Clegg | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Mike Donaldson | M | member | NowMensHealth.Care | nowmenshealth.care |
| Clayton Allmon | M | member | NowMensHealth.Care | nowmenshealth.care |
| Jeff Hall | ? | member | Jane F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Corey Tousley | M | member | NowMensHealth.Care | nowmenshealth.care |
| Justin Schaefer | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Reina Metcalf | F | member | NowPrimary.Care | nowprimary.care |
| Clayton Heath | M | member | NowMensHealth.Care | nowmenshealth.care |
| Dan Kowalsky | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Vincent Robledo | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Joe Karcie | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Bill Drevyanko | M | member | NowMensHealth.Care | nowmenshealth.care |
| Darrell James McClintock | ? | member | Jane F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Jamie Aten | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Mike Kuykendall | M | member | NowMensHealth.Care | nowmenshealth.care |
| Eric Allione | M | member | Approved Disc / Pro-Bono PT | nowmenshealth.care |
| Christopher Lynn | M | member | NowMensHealth.Care | nowmenshealth.care |
| Ryan Roberts | M | member | NowMensHealth.Care | nowmenshealth.care |
| Don Karcie | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Larry Schmidt | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Devin Yogerst | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Chris Manning | ? | member | NowPrimary.Care | nowprimary.care |
| Michael Snyder | M | member | NowMensHealth.Care | nowmenshealth.care |
| Dean Nyhart | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Brian McCready | M | member | NowMensHealth.Care | nowmenshealth.care |
| Michael Garcia | M | member | NowMensHealth.Care | nowmenshealth.care |
| App Tester | ? | member | NowMensHealth.Care | nowmenshealth.care |
| John Doe2 | M | member | NowPrimary.Care | nowprimary.care |
| Barrett Johnson | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Nathan Jaramillo | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Kyle Jacob Layton | M | member | NowMensHealth.Care | nowmenshealth.care |
| Brandon Drescher | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Von Larson | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Phillip Schafer | M | member | NowMensHealth.Care | nowmenshealth.care |
| Ryan Foster | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Richard Toms | M | member | NowMensHealth.Care | nowmenshealth.care |
| Phil Joswiak | ? | member | NowMensHealth.Care | nowmenshealth.care |
| David Tutrone | ? | member | NowMensHealth.Care | nowmenshealth.care |
| vincent gallegos | M | member | NowMensHealth.Care | nowmenshealth.care |
| Grant Quezada | M | member | Approved Disc / Pro-Bono PT | nowmenshealth.care |
| Cris Acosta | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Joe Hugill | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Rodney Courtney | M | member | NowMensHealth.Care | nowmenshealth.care |
| Brad Odom | M | member | NowMensHealth.Care | nowmenshealth.care |
| Anthony Horn | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Brandon Meyer | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Joshua Straight | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Eric Rolland | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Eric Foster | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Benjamin Baker | ? | member | NowMensHealth.Care | nowmenshealth.care |
| GHL Test Final | ? | member | Approved Disc / Pro-Bono PT | nowmenshealth.care |
| Integration Test Two | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Test Menshealth Patient | ? | member | Approved Disc / Pro-Bono PT | nowmenshealth.care |
| Bruce French | M | member | NowMensHealth.Care | nowmenshealth.care |
| Dylan Woods | M | member | NowMensHealth.Care | nowmenshealth.care |
| Greg Lucas | M | member | NowMensHealth.Care | nowmenshealth.care |
| Jake Ticer | M | member | Jane F&F/FR/Veteran $140/Month | nowprimary.care |
| Joseph Pennington | M | member | NowMensHealth.Care | nowmenshealth.care |
| Garth Bascom | M | member | NowMensHealth.Care | nowmenshealth.care |
| Sam Breyer | M | member | Approved Disc / Pro-Bono PT | nowmenshealth.care |
| Mike Katusik | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Jason Lee | M | member | NowMensHealth.Care | nowmenshealth.care |
| David Simpson | M | member | NowMensHealth.Care | nowmenshealth.care |
| Jim Owens | M | member | NowMensHealth.Care | nowmenshealth.care |
| Laura Bovee | ? | member | PrimeCare Premier $50/Month | — |
| Dustin Dragos | M | member | NowMensHealth.Care | nowmenshealth.care |
| Sebastian Griffith | M | member | NowMensHealth.Care | nowmenshealth.care |
| Rich Freeman | M | member | NowMensHealth.Care | nowmenshealth.care |
| Jesse Schafer | M | member | Approved Disc / Pro-Bono PT | nowmenshealth.care |
| Roger McClure | ? | member | Jane TCMH $180/Month | — |
| Jaclyn Shaver | F | member | PrimeCare Premier $50/Month | — |
| Brian Minor | ? | member | Jane F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Greg Eastom | M | member | NowPrimary.Care | nowmenshealth.care |
| Donavon Connor | M | member | NowMensHealth.Care | nowmenshealth.care |
| Margaret Maneely | F | member | PrimeCare Premier $50/Month | — |
| Michelle Fox | F | member | PrimeCare Premier $50/Month | — |
| Tracy Byam | F | member | PrimeCare Premier $50/Month | — |
| Nash Hout | M | member | PrimeCare Premier $50/Month | nowprimary.care |
| Robert Simpson | ? | member | Jane F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Ryan Shaver | M | member | PrimeCare Premier $50/Month | nowprimary.care |
| Coby Cook | M | member | Jane F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Troy Weigel | M | member | NowMensHealth.Care | nowmenshealth.care |
| Janel Freeman | F | member | NowPrimary.Care | — |
| Joseph Sirochman | ? | member | QBO TCMH $180/Month | nowmenshealth.care |
| Mark Breshears | M | member | NowMensHealth.Care | nowmenshealth.care |
| Leah Marley | F | member | PrimeCare Premier $50/Month | nowprimary.care |
| Chris Marley | ? | member | NowPrimary.Care | nowprimary.care |
| Sergio Tadeo | M | member | Jane TCMH $180/Month | nowmenshealth.care |
| Steve Benjamin | ? | member | NowMensHealth.Care | — |
| Edward Bryson | M | member | Ins. Supp. $60/Month | nowmenshealth.care |
| Stephen Wolsey | M | member | NowMensHealth.Care | nowmenshealth.care |
| Eric Hatchell | M | member | NowMensHealth.Care | nowmenshealth.care |
| Nicholas Muenks | ? | member | PrimeCare Premier $50/Month | — |
| Katie Larson | F | member | NowPrimary.Care | nowprimary.care |
| Michael Stultz | M | member | PrimeCare Premier $50/Month | nowprimary.care |
| Rick Andreotta | ? | member | Jane F&F/FR/Veteran $140/Month | — |
| Stanley Woodcock | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Jason Steward | M | member | NowMensHealth.Care | nowmenshealth.care |
| Jakob Woods | M | member | NowMensHealth.Care | nowmenshealth.care |
| Raul Martinez | M | member | NowMensHealth.Care | nowprimary.care |
| Mike Wilson | M | member | NowMensHealth.Care | nowmenshealth.care |
| Russell Smith | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Sean Dorrington | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Ty Lamb | M | member | NowMensHealth.Care | nowmenshealth.care |
| Anthony Bennett | M | member | NowMensHealth.Care | nowmenshealth.care |
| Andrew Haywood | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Cody Crane | M | member | NowMensHealth.Care | nowmenshealth.care |
| Jacob Jackson | M | member | NowMensHealth.Care | nowmenshealth.care |
| David Peterson | M | member | NowMensHealth.Care | nowmenshealth.care |
| Kory Johnson | M | member | NowMensHealth.Care | nowmenshealth.care |
| Mike Watson | M | member | NowMensHealth.Care | nowmenshealth.care |
| John Klafin | M | member | NowMensHealth.Care | nowmenshealth.care |
| John Wheeler | M | member | NowMensHealth.Care | nowmenshealth.care |
| David Perlmutter | M | member | NowMensHealth.Care | nowmenshealth.care |
| Donovan Nelson | M | member | NowMensHealth.Care | nowmenshealth.care |
| Nate Wools | M | member | Ins. Supp. $60/Month | nowmenshealth.care |
| Bret Painter | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Michael Kabbel | M | member | NowMensHealth.Care | nowmenshealth.care |
| Kevin Woods | M | member | NowMensHealth.Care | nowmenshealth.care |
| Ethan Kim | ? | member | QBO F&F/FR/Veteran $140/Month | — |
| Billy Garcia | M | member | NowMensHealth.Care | nowmenshealth.care |
| Mark Williams | M | member | NowMensHealth.Care | nowmenshealth.care |
| Glen Alanis | ? | member | NowMensHealth.Care | nowmenshealth.care |
| John Pierson | M | member | NowMensHealth.Care | nowmenshealth.care |
| Zachary Latham | ? | member | NowMensHealth.Care | — |
| Jim Robertson | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Bruce Seton III | M | member | NowMensHealth.Care | nowmenshealth.care |
| Joshua Holly | M | member | NowMensHealth.Care | nowmenshealth.care |
| Jordan Watkins | M | member | Approved Disc / Pro-Bono PT | nowmenshealth.care |
| Chris fenner | M | member | Ins. Supp. $60/Month | nowmenshealth.care |
| Phil Riccio | M | member | NowMensHealth.Care | nowmenshealth.care |
| Hunter Thundercloud | ? | member | NowMensHealth.Care | — |
| Nathan Mckay | M | member | NowMensHealth.Care | nowmenshealth.care |
| Caleb Williamson | M | member | NowMensHealth.Care | nowmenshealth.care |
| Greg Grabacki | M | member | Approved Disc / Pro-Bono PT | nowmenshealth.care |
| Tim McCracken | M | member | NowMensHealth.Care | nowmenshealth.care |
| Hunter Riley | M | member | NowMensHealth.Care | nowmenshealth.care |
| Donald Haugen | M | member | NowMensHealth.Care | nowmenshealth.care |
| Cole Johnson | M | member | NowMensHealth.Care | nowmenshealth.care |
| Daniel Johnson | M | member | NowMensHealth.Care | nowmenshealth.care |
| Aaron Walters | M | member | NowMensHealth.Care | nowmenshealth.care |
| Micah Metcalf | M | member | NowMensHealth.Care | nowmenshealth.care |
| Eric Lajeunesse | M | member | NowMensHealth.Care | nowmenshealth.care |
| Nikolai Freemyer | ? | member | QBO F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Robert Barr | M | member | NowMensHealth.Care | nowmenshealth.care |
| Matthew Fisher | M | member | NowMensHealth.Care | nowmenshealth.care |
| Chris Crosby | M | member | NowMensHealth.Care | nowmenshealth.care |
| Kyle Alltop | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Robert Evans | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Kyle Dreher | M | member | NowMensHealth.Care | nowmenshealth.care |
| Tayton Town | ? | member | QBO TCMH $180/Month | — |
| Blake Edwards | M | member | Ins. Supp. $60/Month | nowmenshealth.care |
| Myles Baxter | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Robert Teel | M | member | NowMensHealth.Care | nowmenshealth.care |
| Nicholas McCarthy | M | member | QBO F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Jesus Hurtado | ? | member | QBO TCMH $180/Month | nowmenshealth.care |
| Steven Tobin | ? | member | NowMensHealth.Care | — |
| Arie Terpstra | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Bryce Miller | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Richard Murphy | ? | member | NowMensHealth.Care | — |
| Mark Johnson | M | member | NowMensHealth.Care | nowmenshealth.care |
| Joshua Schulte | M | member | NowMensHealth.Care | nowmenshealth.care |
| William Jones | M | member | QBO TCMH $180/Month | nowmenshealth.care |
| Fred Fernow | M | member | NowMensHealth.Care | nowmenshealth.care |
| Danny Fradenburg | M | member | NowMensHealth.Care | nowmenshealth.care |
| Brad Penner | ? | member | Approved Disc / Pro-Bono PT | nowprimary.care |
| Joseph Gleekel | M | member | NowMensHealth.Care | nowmenshealth.care |
| William Thunstedt | M | member | NowMensHealth.Care | nowmenshealth.care |
| Danny Shaughnessy | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Alma Krueger | ? | member | PrimeCare Elite $100/Month | — |
| Nick Scanlan | M | member | NowMensHealth.Care | nowmenshealth.care |
| Jander Nolasco | M | member | NowMensHealth.Care | nowmenshealth.care |
| Tyler Ellsworth | ? | member | QBO F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Linda Hargrave | F | member | PrimeCare Elite $100/Month | nowmenshealth.care |
| Michael Steinhaus | M | member | NowMensHealth.Care | nowmenshealth.care |
| Mathew Sabicer | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Rob Leahy | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Jonathan Headings | ? | member | QBO TCMH $180/Month | — |
| Saben Western | M | member | NowMensHealth.Care | nowmenshealth.care |
| Alex Halenka | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Steve Schott | M | member | Ins. Supp. $60/Month | — |
| Ray Raygoza | M | member | NowMensHealth.Care | nowmenshealth.care |
| Michael Kulik | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Cody Cox | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Robert Raymond | M | member | NowMensHealth.Care | nowmenshealth.care |
| Frank Hahn | M | member | NowMensHealth.Care | nowmenshealth.care |
| Milfred Tewawina | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Casey Byrne | M | member | Jane TCMH $180/Month | nowmenshealth.care |
| Samuel DeFelice | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Devin Connor | M | member | NowMensHealth.Care | nowmenshealth.care |
| James German | M | member | NowMensHealth.Care | nowmenshealth.care |
| Michael McCartney | M | member | NowMensHealth.Care | nowmenshealth.care |
| Shawn Antrim | M | member | Ins. Supp. $60/Month | nowmenshealth.care |
| Robert Campbell | M | member | PrimeCare Premier $50/Month | nowprimary.care |
| Jamie Cooper | ? | member | NowMensHealth.Care | — |
| Michael Cundari | M | member | NowMensHealth.Care | nowmenshealth.care |
| Scott Osborne | M | member | NowMensHealth.Care | nowmenshealth.care |
| Jackie Miller | ? | member | NowMensHealth.Care | nowprimary.care |
| Rick Murphy Jr. | ? | member | PrimeCare Elite $100/Month | — |
| Keith Percy | M | member | NowMensHealth.Care | nowmenshealth.care |
| Chance Haugen | M | member | NowMensHealth.Care | nowmenshealth.care |
| James Bowley | M | member | NowMensHealth.Care | nowmenshealth.care |
| Jim Densmore | M | member | NowMensHealth.Care | nowmenshealth.care |
| Stewart Cox | ? | member | NowMensHealth.Care | nowmenshealth.care |
| PJ Lindblad | M | member | NowMensHealth.Care | nowmenshealth.care |
| Stuart Holleman | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Eric Williams | M | member | NowMensHealth.Care | nowmenshealth.care |
| Evan Womble | M | member | NowMensHealth.Care | nowmenshealth.care |
| Chris Arce | M | member | NowMensHealth.Care | nowmenshealth.care |
| Kevin Hilton | ? | member | QBO TCMH $180/Month | nowmenshealth.care |
| Nick Pauletto | M | member | NowMensHealth.Care | nowmenshealth.care |
| Derek Smith | M | member | NowMensHealth.Care | nowmenshealth.care |
| Travis Gonzales | M | member | NowMensHealth.Care | nowmenshealth.care |
| Erik Meinhardt | M | member | Ins. Supp. $60/Month | nowmenshealth.care |
| Rory Schaafsma | M | member | NowMensHealth.Care | nowmenshealth.care |
| Todd Abel | M | member | NowMensHealth.Care | nowmenshealth.care |
| Alex Vakula | ? | member | QBO TCMH $180/Month | — |
| Robert Johnson | M | member | PrimeCare Premier $50/Month | nowprimary.care |
| Michael Matter | M | member | NowMensHealth.Care | nowmenshealth.care |
| Michael Bagley | M | member | NowMensHealth.Care | nowmenshealth.care |
| Brandon Rizzotto | M | member | NowMensHealth.Care | nowmenshealth.care |
| Joshua Viol | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Webb Wartelle | M | member | NowMensHealth.Care | nowmenshealth.care |
| Danny Anderson | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Jeremy Spaulding | M | member | NowMensHealth.Care | nowmenshealth.care |
| Travis Hawkins | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Andrew Taylor | ? | member | QBO F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Larry Dorrell | M | member | NowMensHealth.Care | nowmenshealth.care |
| Hunter Badilla | M | member | NowMensHealth.Care | nowmenshealth.care |
| Frank Fleming | M | member | NowMensHealth.Care | nowmenshealth.care |
| William Pate | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Pat Galan | M | member | NowMensHealth.Care | nowmenshealth.care |
| Ezra Galpin | M | member | NowMensHealth.Care | nowmenshealth.care |
| Randy McDonald | M | member | NowMensHealth.Care | nowmenshealth.care |
| Beau Westphal | ? | member | NowMensHealth.Care | — |
| Joseph Lucero | M | member | NowMensHealth.Care | nowmenshealth.care |
| Leon Moise | M | member | NowMensHealth.Care | nowmenshealth.care |
| Dustin Elsea | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Jeffrey Chamblee | ? | member | NowMensHealth.Care | — |
| Scott Hovelsrud | M | member | NowMensHealth.Care | nowmenshealth.care |
| Bradley Knippa | ? | member | NowMensHealth.Care | nowmenshealth.care |
| David Baggenstos | M | member | NowMensHealth.Care | nowmenshealth.care |
| Chad Richey | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Jeff Sandy | M | member | NowMensHealth.Care | nowmenshealth.care |
| Keith Levin | M | member | NowMensHealth.Care | nowmenshealth.care |
| Ken Thompson | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Glenn Smith | M | member | NowMensHealth.Care | nowmenshealth.care |
| Bryan` Campbell | ? | member | QBO F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Cameron Metcalf | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Joey Clayton | ? | member | NowMensHealth.Care | nowmenshealth.care |
| David Newman | ? | member | QBO F&F/FR/Veteran $140/Month | — |
| Dominic Milano | M | member | PrimeCare Elite $100/Month | nowprimary.care |
| Jeff Ames | ? | member | QBO TCMH $180/Month | — |
| Andrew Strople | M | member | QBO F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Stacey Hickman | M | member | Ins. Supp. $60/Month | nowmenshealth.care |
| Tisa Milano | ? | member | PrimeCare Elite $100/Month | nowprimary.care |
| Jennifer Pearl | ? | member | PrimeCare Elite $100/Month | — |
| Travis Condon | ? | member | PrimeCare Premier $50/Month | nowprimary.care |
| Sean Onion | ? | member | Ins. Supp. $60/Month | — |
| Ron Muenks | ? | member | Ins. Supp. $60/Month | nowmenshealth.care |
| Dale Tiberg | ? | member | Jane F&F/FR/Veteran $140/Month | — |
| Jack Pulley | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Geno Garsha | M | member | NowMensHealth.Care | nowmenshealth.care |
| Skip Yost | M | member | NowMensHealth.Care | nowmenshealth.care |
| Anthony DePaolantonio | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Levi Burlington | M | member | NowMensHealth.Care | nowmenshealth.care |
| Spencer Edmonds | M | member | NowMensHealth.Care | nowmenshealth.care |
| Garrett Taylor | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Mark Voelkel | ? | member | QBO F&F/FR/Veteran $140/Month | — |
| Randy Schafer | M | member | Approved Disc / Pro-Bono PT | nowmenshealth.care |
| Steve Evans | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Robert Robbins | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Alan Kenson | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Tim Dixon | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Edward McKeever | M | member | NowMensHealth.Care | nowmenshealth.care |
| JT Guynes | ? | member | Jane F&F/FR/Veteran $140/Month | — |
| David Edwards | M | member | Jane TCMH $180/Month | nowmenshealth.care |
| Keith Bunger | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Kristen Bunger | ? | member | PrimeCare Premier $50/Month | nowprimary.care |
| John Shea | M | member | NowMensHealth.Care | nowmenshealth.care |
| Steve Edwards | ? | member | QBO TCMH $180/Month | — |
| Cody Clark | ? | member | QBO TCMH $180/Month | — |
| Andre Skidmore | ? | member | NowMensHealth.Care | — |
| Chris Libis | M | member | NowMensHealth.Care | nowmenshealth.care |
| Todd Buck | ? | member | QBO TCMH $180/Month | — |
| Nate Hallowell | M | member | QBO TCMH $180/Month | nowmenshealth.care |
| Karl Sproule | M | member | NowMensHealth.Care | nowmenshealth.care |
| David Hernandez | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Eric Schroeter | ? | member | Ins. Supp. $60/Month | nowmenshealth.care |
| Joe Ramos | M | member | Jane F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Mike Kuenzi | ? | member | Jane TCMH $180/Month | nowmenshealth.care |
| Steve Mann | M | member | NowMensHealth.Care | nowmenshealth.care |
| Eric Christopherson | ? | member | QBO TCMH $180/Month | — |
| James Lentz | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Mark Palm | M | member | Jane F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Erik Siebert | M | member | NowMensHealth.Care | nowmenshealth.care |
| John Stonecipher | ? | member | Approved Disc / Pro-Bono PT | nowmenshealth.care |
| Lynn Ragels | M | member | PrimeCare Premier $50/Month | — |
| Albert Black | ? | member | Jane TCMH $180/Month | nowmenshealth.care |
| Lyndon Edmonson | M | member | NowMensHealth.Care | nowmenshealth.care |
| Jonathan Teague | ? | member | QBO F&F/FR/Veteran $140/Month | — |
| Tony Shepard | M | member | NowMensHealth.Care | nowmenshealth.care |
| Stephen Eakman | M | member | NowMensHealth.Care | nowmenshealth.care |
| Brandon Corrales | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Alivia Mullen | ? | member | NowPrimary.Care | nowprimary.care |
| Jonathon Hart | M | member | NowPrimary.Care | nowprimary.care |
| David Wyngaarden | M | member | NowMensHealth.Care | nowmenshealth.care |
| Seth Jesson | M | member | PrimeCare Premier $50/Month | — |
| Douglas Dolan | M | member | Jane TCMH $180/Month | nowmenshealth.care |
| Michael Newell-Bauer | M | member | NowMensHealth.Care | nowmenshealth.care |
| Bill Griffith | ? | member | Jane TCMH $180/Month | — |
| Ray Justus | M | member | NowMensHealth.Care | nowmenshealth.care |
| Glenn Ragels | ? | member | NowPrimary.Care | nowprimary.care |
| Ben Naasz | M | member | NowMensHealth.Care | nowmenshealth.care |
| Steven Sepulveda | M | member | PrimeCare Premier $50/Month | nowprimary.care |
| Jake Reiter | M | member | NowPrimary.Care | nowprimary.care |
| Jimbo Blain | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Deana Winn | ? | member | PrimeCare Elite $100/Month | — |
| Christopher Heilman | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Kristen Bunger | F | member | Approved Disc / Pro-Bono PT | nowprimary.care |
| Andrew Deering | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Brian Buckley | ? | member | Approved Disc / Pro-Bono PT | — |
| Bob Walker | ? | member | Jane F&F/FR/Veteran $140/Month | nowprimary.care |
| Bennett Bunger | ? | member | Approved Disc / Pro-Bono PT | nowprimary.care |
| Andrew Lang | M | member | NowMensHealth.Care | nowmenshealth.care |
| Kenneth Holley | M | member | NowMensHealth.Care | nowmenshealth.care |
| David Cruz | ? | member | QBO TCMH $180/Month | — |
| Andy Austin | M | member | Ins. Supp. $60/Month | nowmenshealth.care |
| Amanda Austin | F | member | PrimeCare Elite $100/Month | — |
| Matthew Manning | M | member | Jane F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Dale Potter | ? | member | NowPrimary.Care | nowprimary.care |
| John Winn | ? | member | Ins. Supp. $60/Month | nowmenshealth.care |
| Joe Allen | ? | member | QBO TCMH $180/Month | — |
| Jon Gonzales | ? | member | QBO F&F/FR/Veteran $140/Month | — |
| Keira Gannon | ? | member | Jane F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Logan Harrison | ? | member | QBO F&F/FR/Veteran $140/Month | — |
| Luke McCarthy | M | member | NowMensHealth.Care | nowmenshealth.care |
| Nikki Murphy | F | member | PrimeCare Elite $100/Month | — |
| Jacob McKenney | M | member | NowMensHealth.Care | nowmenshealth.care |
| Jennifer Greene | ? | member | NowPrimary.Care | — |
| Michele Meyer | F | member | PrimeCare Premier $50/Month | — |
| Sandy schilling | ? | member | PrimeCare Elite $100/Month | — |
| Brian Norris | M | member | NowMensHealth.Care | nowmenshealth.care |
| Caleb Rentschler | M | member | NowMensHealth.Care | nowmenshealth.care |
| Dustin Pennington | ? | member | QBO TCMH $180/Month | — |
| Calvin Campbell | M | member | Jane F&F/FR/Veteran $140/Month | nowmenshealth.care |
| Jen Frederick | ? | member | PrimeCare Elite $100/Month | nowprimary.care |
| ed mcmahan | ? | member | NowMensHealth.Care | — |
| Pete Wenz | M | member | NowMensHealth.Care | nowmenshealth.care |
| Heather Aringdale | ? | member | NowPrimary.Care | — |
| Lin Scarpitto | ? | member | PrimeCare Premier $50/Month | — |
| Jeffrey Floyd | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Robert Seiler | ? | member | QBO TCMH $180/Month | nowmenshealth.care |
| Cesar Astorga | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Jason Fremouw | ? | member | NowMensHealth.Care | nowmenshealth.care |
| David Holmes | ? | member | NowMensHealth.Care | nowmenshealth.care |
| Mike Kunde | ? | member | NowMensHealth.Care | nowmenshealth.care |

</details>

---

## Next Steps
1. Resolve confirmed action items (§0) — low risk.
2. Resolve duplicates (§2) — staff picks keeper.
3. Relink/archive orphans (§3).
4. Apply HIGH-confidence classifications from §4 in a batch (with Phil review).
5. Everything else stays in the Unclassified tab for manual staff review.