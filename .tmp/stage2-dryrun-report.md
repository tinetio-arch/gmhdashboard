# Stage 2 Dry-Run — Classifier Proposals for 22 NULL Patients

**Generated:** 2026-05-05T18:09:37.504Z
**Scope:** active + active_pending patients with NULL or empty `client_type_key`
**Total:** 8

**No DB writes. Markdown only. Phil reviews row-by-row before Stage 2 apply.**

Confidence: 🟢 high · 🟡 medium · 🔴 none

## Summary
- **Will apply (clear signal):** 6
- **Will skip (no signal — stay manual queue):** 2

## Proposed updates

| # | Patient | Gender | Clinic | Proposed key | Conf | Membership | Dispenses | Evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | **Dave Brown** `098a7ff0` | ? | — | `nowmenshealth` | 🟢 high | — | 0 (last: —) | Initial Male Hormone Replacement Consult |
| 2 | **Faith Dekens** `5cb5ede6` | F | — | `nowlongevity` | 🟢 high | — | 0 (last: —) | EvexiPel Repeat Pelleting Procedure Female |
| 3 | **George Navarre** `6d2f8f64` | M | — | `nowmenshealth` | 🟢 high | — | 0 (last: —) | NMH TRT Supply Refill |
| 4 | **Jackson Woods** `d838c789` | M | — | `nowmenshealth` | 🟢 high | — | 0 (last: —) | Initial Male Hormone Replacement Consult |
| 5 | **John Lucas** `6306449e` | ? | — | `nowmenshealth` | 🟢 high | — | 0 (last: —) | Initial Male Hormone Replacement Consult |
| 6 | **John McKee** `c0fa08c4` | M | — | `sick_visit` | 🟡 medium | — | 0 (last: —) | Telemedicine Sick Consult |

## Will skip — no clear signal

| # | Patient | Gender | Clinic | Healthie ID | Membership | Dispenses | Why skipped |
|---|---|---|---|---|---|---|---|
| 1 | **Bradley Odom** `8e04d4b3` | ? | — | 12745500 | — | 0 (last: —) | appts didn't match rules: 90 Day Lab Draw |
| 2 | **James Womble** `02d24f1d` | M | — | 12743400 | — | 0 (last: —) | no appointments in Healthie |

## What happens if Phil approves
1. UPDATE `patients` SET `client_type_key` = proposed key, `client_type_key_updated_at` = NOW() for the **Will apply** rows above.
2. INSERT into `client_type_audit` for each row: `from_value=NULL`, `to_value=<proposed>`, `source='reconciler'`, `confidence=<level>`, `evidence={appt_types: [...]}`.
3. **Will skip** rows stay NULL — they go into the manual review queue.
4. Single transaction — any error rolls back all 22 rows.

## Effects on production
- **Peptide discount:** patients mapped to `nowmenshealth`/`nowprimarycare`/`nowlongevity` start getting the 20% NOW-brand courtesy discount on peptides.
- **Receipt branding:** patients mapped to `nowmenshealth` get Men's Health receipt template instead of generic.
- **CEO revenue/patient counts:** these patients leave the "(NULL)" bucket and join their proper brand bucket.
- **Net dollar impact: $0** — only re-bucketing existing revenue.