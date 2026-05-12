# Patient Linking Audit
Generated: 2026-04-16T18:01:52.312Z

## Summary

| Category | Count | Meaning |
|---|---:|---|
| A. Healthy links | 358 | Postgres row ↔ active Healthie user, link resolves |
| B. In Healthie, missing from Postgres | 5075 | Never imported (Jacob pattern) |
| C. In Postgres, Healthie user gone | 41 | Deleted / inactive in Healthie but our row still linked |
| D. Healthie-side duplicates (name+DOB) | 12 | Same person with multiple Healthie IDs |
| D. Healthie-side duplicates (real email) | 50 | Multiple Healthie records sharing a real email |
| E. Linked to placeholder-email dupe | 1 | Our link points at a @gethealthie.com stub when a real record exists (Bruce French pattern) |
| F. Data conflicts (email/phone/DOB) | 57 | Field mismatch between our row and Healthie |
| G. Our-side duplicates | 0 | Multiple Postgres patients point at the same Healthie ID |
| H. Orphan healthie_clients rows | 42 | healthie_clients row pointing at a Healthie ID that isn't active |
| I. Postgres with no Healthie link at all | 2 | Not linked, never matched |

**Healthie active total:** 5433
**Postgres patients total:** 401
**Runtime:** 2s

## Category B — In Healthie, missing from Postgres (5075)
These are patients added directly in Healthie that never got into our DB. Webhook upsert (deployed earlier) will catch new ones going forward; the nightly reconciliation cron will drain this backlog.

| Healthie ID | Name | Email | Phone | DOB | Created |
|---|---|---|---|---|---|
| 12741349 | Randy ? | 36dc566fa711aa28d5d0caec3622d905@gethealthie.com |  |  | 2026-01-14 14:15:16 -0700 |
| 12741362 | Sharon ? | loierlv@gmail.com | 17025245363 |  | 2026-01-14 14:15:18 -0700 |
| 12741367 | dina abbo | dina.bot@yahoo.com | 16026977581 | 1979-03-16 | 2026-01-14 14:15:18 -0700 |
| 12741374 | Bernadine Abbott | btcandelaria_abbott@yahoo.com | 14804505137 | 1962-03-18 | 2026-01-14 14:15:19 -0700 |
| 12741382 | Casey Abbott | caseyabbtt@aol.com | 19289103065 | 1975-08-17 | 2026-01-14 14:15:20 -0700 |
| 12741386 | Marilyn Abel | marilynabel@me.com | 15202716241 |  | 2026-01-14 14:15:20 -0700 |
| 12741397 | Jessica Abernathy | c9b745b359aee32c1a42146836fde149@gethealthie.com | 16613645183 |  | 2026-01-14 14:15:21 -0700 |
| 12741403 | Misty Ableman-Skinner | mistygem84@gmail.com | 19287106315 |  | 2026-01-14 14:15:22 -0700 |
| 12741410 | Angela Abstance | angelac7486@gmail.com | 16232290481 | 1986-07-04 | 2026-01-14 14:15:23 -0700 |
| 12741419 | Jennifer Abt | jeniabt@gmail.com | 12054704640 | 1982-11-05 | 2026-01-14 14:15:24 -0700 |
| 12741427 | Karen Aceves | rickkarena@gmail.com | 16616187360 | 1959-05-01 | 2026-01-14 14:15:25 -0700 |
| 12741435 | Lorraine Acheson | lorenaleon2@aol.com | 15059178307 | 1960-09-03 | 2026-01-14 14:15:27 -0700 |
| 12741449 | Melissa Achimon | melachimon@yahoo.com | 16232975708 | 1979-06-11 | 2026-01-14 14:15:28 -0700 |
| 12741455 | Kelli Acker | soulimages1@gmail.com | 16029998557 |  | 2026-01-14 14:15:29 -0700 |
| 12741461 | Alison Ackley | alicatz1005@gmail.com | 19283083191 | 1978-10-05 | 2026-01-14 14:15:30 -0700 |
| 12741480 | Lenny Acosta | 3a3e3b9d2d65159d072356210d822bf1@gethealthie.com | 17323976616 |  | 2026-01-14 14:15:31 -0700 |
| 12741487 | Amanda Adam | amanda.adam8@icloud.com | 19282737681 | 1979-06-20 | 2026-01-14 14:15:32 -0700 |
| 12741495 | christopher Adam | adfdd57d3996b6e313c71148872e7563@gethealthie.com |  |  | 2026-01-14 14:15:33 -0700 |
| 12741501 | Lynn Adamick | lynnadamick0618@gmail.com | 16029097264 |  | 2026-01-14 14:15:34 -0700 |
| 12741514 | Brittany Adams | brittanyjadams2012@gmail.com | 4999241 | 1989-06-09 | 2026-01-14 14:15:35 -0700 |

_...and 5055 more_

## Category C — In Postgres, Healthie user gone (41)
Our row links to a Healthie ID that isn't in the active roster. Could be inactive/archived in Healthie, or the ID changed.

| PG ID | Name | Email | Linked Healthie ID | Status |
|---|---|---|---|---|
| 73f020d6 | Logan Harrison | harrisonlogan27@gmail.com | 12742033 | inactive |
| fa75dcdd | Keira Gannon | azgannonfam@gmail.com | 12746078 | inactive |
| 6a196999 | John Doe2 | hello@nowoptimal.com |  | inactive |
| 0d3bf4a6 | Jesus Cris Acosta Acosta | teteacosta12111987@gmail.com | 12741471 |  |
| bca6b085 | GHL Test Final |  | 12612283 | inactive |
| abb4b129 | Andre Skidmore | skidion@verizon.net | 12165213 | inactive |
| c0e94ac6 | App Tester | apptest@nowoptimal.com |  | inactive |
| aa26dd87 | Kristen Bunger | Kristen@bodyandsoulRD.com | 12745142 | active |
| e8632eee | ed mcmahan | edmcmahan2020@gmail.com | 12165065 | inactive |
| 842c5b2a | Jon Gonzales | jgonzales2386@gmail.com | 12746668 | inactive |
| 52221564 | Sam Breyer |  | 12183157 | active |
| e87291ae | David Cruz | dpc9000@yahoo.com | 12177472 | inactive |
| dd8cca70 | Integration Test Two |  | 12609497 | inactive |
| 2c6b3fd6 | Alex Vakula | avakula@icloud.com | 12177291 | inactive |
| 7cf5ec98 | Jonathan Headings | jonathantherealtor04@gmail.com | 12178042 | inactive |
| dbbeb87e | Joe Allen | joeallenaz@yahoo.com | 12741843 | inactive |
| a1eaa7f1 | Sandy schilling | sschilli9151@gmail.com | 12743563 | inactive |
| 8449f3ba | Dustin Pennington | dustin.m.pennington@gmail.com | 12746528 | inactive |
| c2a9e6a2 | Laura Bovee | nomelmk@yahoo.com | 12212078 | inactive |
| 6657d470 | Todd Buck | toddbuck.castlehomeinspection@gmail.com | 12179357 | inactive |

_...and 21 more_

## Category D — Healthie-side duplicates (12 by name+DOB, 50 by email)
Same person appears multiple times in Healthie. Our link picks one, may not be the right one.

### By name + DOB
| Name | DOB | Healthie IDs | Count |
|---|---|---|---|
| Steve Benjamin | 1987-10-03 | 12182852, 12743724 | 2 |
| Jeffrey Chamblee | 1974-11-26 | 12177838, 12746108 | 2 |
| Matthew Fisher | 2000-10-09 | 12179965, 12745295 | 2 |
| Rich Freeman | 1955-05-24 | 12183013, 12745768 | 2 |
| Bruce French | 1964-10-19 | 12745786, 12765861 [placeholder] | 2 |
| Joe Hugill | 1973-04-24 | 12690358, 12875775 [placeholder] | 2 |
| John Jones | 1985-05-12 | 12775834, 14408179 | 2 |
| Michael McCartney | 1979-03-13 | 12182822, 12742218 | 2 |
| Alana Morrison | 1982-09-13 | 12744305, 15192295 | 2 |
| Marianna Warner | 1952-12-30 | 12742313, 14050273 | 2 |
| John Winn | 1966-02-09 | 12182229, 12743211 | 2 |
| James Womble | 1986-09-15 | 12179578, 12743400 | 2 |


### By real email
| Email | Healthie records | Count |
|---|---|---|
| heather.aringdale@gmail.com | 12742438 (Dylan Aringdale), 12209739 (Heather Aringdale), 12742443 (Maxon Aringd | 4 |
| amandamarieaustin@yahoo.com | 12705573 (Amanda Austin), 12742682 (Andrew Austin), 12182005 (Andy Austin) | 3 |
| stephenb0085@gmail.com | 12182852 (Steve Benjamin), 12743724 (Steve Benjamin) | 2 |
| chrismarie1027@gmail.com | 12743843 (Caden Bernier), 12743847 (Christina Bernier) | 2 |
| tinetio@yahoo.com | 12491192 (Alice Brown), 12775834 (John Jones), 12745744 (Jennifer ONeill), 12493 | 4 |
| keith.w.bunger@gmail.com | 12745123 (Anderson Bunger), 12165262 (Keith Bunger) | 2 |
| kristen@bodyandsoulrd.com | 12765832 (Bennett Bunger), 12208881 (Kristen Bunger Bunger) | 2 |
| burkeman68@gmail.com | 12745189 (Tim Burke), 12880923 (Timothy Burke) | 2 |
| bryan.campbell6174@yahoo.com | 12745462 (Bryan Campbell), 12179459 (Bryan` Campbell) | 2 |
| jchamblee24@yahoo.com | 12177838 (Jeffrey Chamblee), 12746108 (Jeffrey Chamblee) | 2 |
| jkcooper@sendinghope.com | 12741442 (James Cooper), 12177728 (Jamie Cooper) | 2 |
| prescottadmin@artisanaesthetics.com | 14409218 (John Erickson), 12745699 (Test Subject One) | 2 |
| robertevans44@hotmail.com | 12178926 (Robert Evans), 12744537 (Robert "Rob" Evans) | 2 |
| snoopybiscuit6@gmail.com | 12745133 (Elyse Fields), 12744227 (Dustin Johnson) | 2 |
| m.lopezfisher@yahoo.com | 12179965 (Matthew Fisher), 12745295 (Matthew Fisher) | 2 |
| danny25883@gmail.com | 12179547 (Danny Fradenburg), 12745677 (Emalina Fradenburg) | 2 |
| jfred0721@gmail.com | 12745735 (Greyson Frederick), 12745738 (Iris Frederick), 12208996 (Jen Frederick | 4 |
| jrfreeman1983@outlook.com | 12745763 (Janel Freeman), 12183013 (Rich Freeman), 12745768 (Rich Freeman) | 3 |
| azgannonfam@gmail.com | 12746074 (Greg Gannon), 12182730 (Keira Gannon) | 2 |
| alex@halenkainvestments.com | 12177280 (Alex Halenka), 12741554 (Alexander Halenka) | 2 |

_...and 30 more_

## Category E — Linked to placeholder-email dupe (1)
Our patient is linked to a Healthie record with a @gethealthie.com stub email when a sibling Healthie record for the same person has the real email. Relinking to the real-email one would improve GHL matching + SMS routing. **Bruce French** is here.

| Patient | Current link | Current email | Better link | Better email |
|---|---|---|---|---|
| Bruce French | 12765861 | 1ba2f1454ec57be6850cd4eaae01bf25@gethealthie.com | 12745786 | brucefrench1@hotmail.com |

## Category F — Data conflicts (57)
Field mismatch between Postgres and Healthie. Healthie is SOT per memory; our data should be updated to match.

| Patient | Healthie ID | Conflicts |
|---|---|---|
| Joe Karcie | 14144143 | dob: pg="1978-02-08" hl="1978-08-02" |
| John Stonecipher | 12745264 | phone: pg="(928) 277-7000" hl="19282777000" |
| Michael Stultz | 12745449 | phone: pg="9289255831" hl="19289255831" |
| Chris Manning | 13588381 | email: pg="chris5191973@yahooo.com" hl="chris5191973@icloud.com" |
| Cole Johnson | 12744193 | phone: pg="(928) 713-5751" hl="19287135751" |
| Richard Toms | 12746172 | phone: pg="(858) 776-1902" hl="18587761902" |
| Jeff Hall | 14431239 | email: pg="hallf0d@erau.edu" hl="ontargetjeff@protonmail.com" |
| Bennett Bunger | 12765832 | phone: pg="(602) 810-1756" hl="+16028101756" |
| Alivia Mullen | 12209090 | phone: pg="(801) 866-3858" hl="(801) 648-5966 " |
| Grant Quezada | 12747059 | phone: pg="(253) 948-7808" hl="12539487808" |
| Scott Osborne | 12164995 | phone: pg="+19495331557" hl="9495331557"; dob: pg="1960-04-08" hl="1960-08-04" |
| Eric Allione | 12741915 | phone: pg="(808) 347-1882" hl="18083471882" |
| Darrell James McClintock | 14076244 | dob: pg="1981-08-17" hl="1984-09-13" |
| Phil Joswiak | 13113511 | phone: pg="(928) 350-7661" hl="(928) 458-6803 " |
| Michael Steinhaus | 12745140 | phone: pg="(915) 342-8555" hl="19153428555" |
| vincent gallegos | 12746029 | phone: pg="(928) 848-0276" hl="19288480276" |
| Kenneth Holley | 12165146 | phone: pg="+16618093264" hl="6618093264" |
| Greg Lucas | 12256484 | phone: pg="(928) 925-3529" hl="19289253529" |
| Levi Burlington | 12745220 | phone: pg="(928) 856-1219" hl="19288561219" |
| Robert Campbell | 12745475 | phone: pg="(602) 471-5647" hl="16024715647" |

_...and 37 more_

## Category G — Our-side duplicates (0)
Multiple Postgres rows point at the same Healthie ID. One is the real patient; the other(s) are ghost rows from earlier buggy imports.

_(none)_

## Category H — Orphan healthie_clients (42)
healthie_clients row has is_active=true but the Healthie user isn't in the active roster. Stale link.

| Healthie ID | PG patient_id | Match method |
|---|---|---|
| 12165065 | e8632eee | email_lookup |
| 12165194 | 6810a6f1 | email_lookup |
| 12165213 | abb4b129 | email_lookup |
| 12177291 | 2c6b3fd6 | email |
| 12208205 | e0dbc7fe | email |
| 12176783 | 3a9f48b4 | phone |
| 12182608 | 5a97489b | email |
| 12179436 | 78e355e0 |  |
| 12177472 | e87291ae | email |
| 12179555 | 49877ac5 | email |
| 12177549 | 52c8b018 | email |
| 12177805 | 6ec2e696 | email |
| 12178042 | 7cf5ec98 | email |
| 12182783 | a5b9509c | email |
| 12212078 | c2a9e6a2 | email |
| 12179944 | 79ee3840 | email |
| 12182840 | 6cf9d41e | email |
| 12182292 | 484c6c7c | email |
| 12183157 | 52221564 | phone |
| 12183028 | 6740f4f1 | email |

_...and 22 more_

## Category I — Postgres, no link (2)
Patient row exists in our DB with NO Healthie link at all (healthie_client_id NULL, no healthie_clients row). Usually means manual DB entry or a failed initial sync.

| PG ID | Name | Email | Phone | Status | Created |
|---|---|---|---|---|---|
| 18b1e8af | Bill Griffith |  |  | inactive | Mon Nov 10 2025 02:54:46 GMT-0700 (Mountain Standard Time) |
| 11879f7a | Test Menshealth Patient |  | (928) 555-0199 | inactive | Thu Jan 08 2026 18:22:28 GMT-0700 (Mountain Standard Time) |
