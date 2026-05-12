-- 20260415: Make service_tag_config gender-aware + Healthie group/tag aware.
--
-- Why: pelleting bug — a female patient tagged 'pelleting' was being shown male
-- pellet appointments (and vice versa) because:
--   (a) the seed used 'evexipel' as the tag key, but Healthie tag is named 'pelleting'
--   (b) only male appt IDs (504727, 504728) were mapped — female (504729, 504730) missing
--   (c) no gender column existed to filter male-vs-female unlocks
--   (d) no healthie_tag_id / healthie_group_id, so adding a tag locally never
--       synced to Healthie group membership (the actual booking gate in Healthie)
--
-- Real Healthie groups (verified 2026-04-15 via API):
--   75522 NowMensHealth.Care
--   75523 NowPrimary.Care
--   82532 NowLongevity.Care
--   82533 NowMentalHealth.Care
--   82534 ABXTAC
--   77894 Sick Visit
--
-- Real pelleting appointment types:
--   504727 EvexiPel Initial Pelleting Procedure Male   (60min)
--   504728 EvexiPel Repeat Pelleting Procedure Male    (45min)
--   504729 EvexiPel Repeat Pelleting Procedure Female  (45min)
--   504730 EvexiPel Initial Pelleting Procedure Female (60min)
--
-- Healthie tag id 82887 = "pelleting"  (single tag, gender split is OUR job)
-- Healthie form id 2949013 = "Female Hormone Pellet Therapy- Intake Form"
--   (no male equivalent exists in Healthie; male pellet patients get no auto-form)

ALTER TABLE service_tag_config
  ADD COLUMN IF NOT EXISTS gender             TEXT CHECK (gender IN ('M','F')) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS healthie_tag_id    TEXT,
  ADD COLUMN IF NOT EXISTS healthie_group_id  TEXT;

-- Replace the legacy 'evexipel' rows with gendered 'pelleting' rows.
DELETE FROM service_tag_config WHERE tag = 'evexipel';

INSERT INTO service_tag_config (tag, appointment_type_id, gender, healthie_tag_id, healthie_group_id, form_id, label, active) VALUES
  ('pelleting', '504730', 'F', '82887', '82532', '2949013', 'EvexiPel Initial Pelleting (Female)', true),
  ('pelleting', '504729', 'F', '82887', '82532', '2949013', 'EvexiPel Repeat Pelleting (Female)',  true),
  ('pelleting', '504727', 'M', '82887', '75522', NULL,      'EvexiPel Initial Pelleting (Male)',   true),
  ('pelleting', '504728', 'M', '82887', '75522', NULL,      'EvexiPel Repeat Pelleting (Male)',    true);

-- Backfill Healthie tag/group ids for the existing tag rows so add-tag flow can sync them.
UPDATE service_tag_config SET healthie_tag_id = '82890', healthie_group_id = '82532' WHERE tag = 'peptides'    AND healthie_tag_id IS NULL;
UPDATE service_tag_config SET healthie_tag_id = '82888', healthie_group_id = '82532' WHERE tag = 'weight-loss' AND healthie_tag_id IS NULL;
-- iv-therapy and telehealth: no canonical Healthie tag yet; leave NULL until staff confirms.

CREATE INDEX IF NOT EXISTS idx_service_tag_config_tag_gender ON service_tag_config (tag, gender);
