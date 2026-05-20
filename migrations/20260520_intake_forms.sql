-- 20260520_intake_forms.sql
-- Self-serve patient intake decoupled from Healthie's native intake flows.
--
-- Goal: a patient can completely set up an account from a public web ("Google-facing")
-- form or the iPhone/iPad app, with answers stored in OUR Postgres as the capture point
-- of record, then PUSHED to Healthie (Healthie stays the clinical record).
--
-- The form schema is DATA-DRIVEN so the same machinery is reused per brand:
--   ABXTAC first, then Now Men's Health / Now Primary Care / Now Longevity.
-- See docs/INTAKE_MIGRATION_PLAYBOOK.md for the repeatable rollout.

BEGIN;

-- ---------------------------------------------------------------------------
-- form_definitions: one row per (brand, slug, version). The active version is
-- what the public form and the mobile app render.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_definitions (
    form_def_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_key                   TEXT NOT NULL,            -- 'abxtac' | 'nowmenshealth' | 'nowprimarycare' | 'nowlongevity'
    slug                        TEXT NOT NULL,            -- url slug, e.g. 'services-agreement'
    name                        TEXT NOT NULL,
    description                 TEXT,
    client_type_key             TEXT NOT NULL,            -- drives Healthie group routing (see lib/patientHealthieSync.ts)
    -- Healthie linkage: when set, completed answers are pushed to this Healthie
    -- custom_module_form via createFormAnswerGroup. NULL = capture locally only
    -- (patient is still created in Healthie, which triggers Healthie's own flow).
    healthie_custom_module_form_id TEXT,
    version                     INTEGER NOT NULL DEFAULT 1,
    is_active                   BOOLEAN NOT NULL DEFAULT true,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (brand_key, slug, version)
);

CREATE INDEX IF NOT EXISTS idx_form_definitions_active
    ON form_definitions (brand_key, slug) WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- form_fields: ordered fields belonging to a form definition. mod_type mirrors
-- Healthie's custom_module mod_type vocabulary so the answer push is 1:1.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_fields (
    field_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_def_id                 UUID NOT NULL REFERENCES form_definitions(form_def_id) ON DELETE CASCADE,
    ordinal                     INTEGER NOT NULL,
    field_key                   TEXT NOT NULL,            -- stable machine key, e.g. 'occupation'
    label                       TEXT NOT NULL,
    mod_type                    TEXT NOT NULL,            -- text|textarea|radio|checkbox|signature|date|email|phone
    required                    BOOLEAN NOT NULL DEFAULT false,
    options                     JSONB,                    -- for radio/checkbox: ["A","B"]
    description                 TEXT,
    -- Maps this field to a Healthie custom_module id so its answer pushes to the
    -- right question. NULL until the brand's Healthie form is mapped (playbook step 4).
    healthie_custom_module_id   TEXT,
    UNIQUE (form_def_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_form_fields_form ON form_fields (form_def_id, ordinal);

-- ---------------------------------------------------------------------------
-- intake_submissions: one row per completed self-serve intake. This is the
-- local capture point of record; provisioning links patient_id + healthie ids.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_submissions (
    submission_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_def_id                 UUID NOT NULL REFERENCES form_definitions(form_def_id),
    brand_key                   TEXT NOT NULL,
    -- Applicant identity captured before a patient record exists
    applicant_name              TEXT NOT NULL,
    applicant_email             TEXT,
    applicant_phone             TEXT,
    date_of_birth               DATE,
    address                     TEXT,
    answers                     JSONB NOT NULL,           -- { field_key: answer }
    signature_data_url          TEXT,
    -- Provisioning results
    patient_id                  UUID REFERENCES patients(patient_id),
    healthie_client_id          TEXT,
    healthie_form_answer_group_id TEXT,
    status                      TEXT NOT NULL DEFAULT 'pending',  -- pending|provisioning|provisioned|healthie_unmapped|error
    error                       TEXT,
    source                      TEXT NOT NULL DEFAULT 'web',      -- web|ios|ipad
    ip_address                  TEXT,
    user_agent                  TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    provisioned_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_intake_submissions_status ON intake_submissions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_submissions_email  ON intake_submissions (lower(applicant_email));
CREATE INDEX IF NOT EXISTS idx_intake_submissions_patient ON intake_submissions (patient_id);

-- ---------------------------------------------------------------------------
-- Seed: ABXTAC "Tactical Services Agreement" (worked example for the playbook).
-- Mirrors the legacy Healthie form in scripts/create-healthie-forms.ts so the
-- patient experience is unchanged when intake moves off Healthie's portal.
-- ---------------------------------------------------------------------------
INSERT INTO form_definitions (brand_key, slug, name, description, client_type_key, version, is_active)
VALUES (
    'abxtac',
    'services-agreement',
    'ABX Tactical Services Agreement',
    'Tactical medicine consultation and antibiotic pack authorization',
    'abxtac',
    1,
    true
)
ON CONFLICT (brand_key, slug, version) DO NOTHING;

-- Fields (idempotent insert keyed on form_def_id + field_key)
INSERT INTO form_fields (form_def_id, ordinal, field_key, label, mod_type, required, options, description)
SELECT d.form_def_id, v.ordinal, v.field_key, v.label, v.mod_type, v.required, v.options, v.description
FROM form_definitions d
CROSS JOIN (VALUES
    (1,  'occupation',              'Occupation',                   'text',     true,  NULL::jsonb, NULL),
    (2,  'professional_background', 'Professional Background',      'radio',    true,  '["First Responder","Military (Active)","Military (Reserve)","Law Enforcement","Other"]'::jsonb, NULL),
    (3,  'training_certifications', 'Training and Certifications',  'textarea', false, NULL, 'List relevant medical/tactical training and certifications'),
    (4,  'deployment_status',       'Deployment Status',            'radio',    true,  '["Active Deployment","Reserve/Training","Civilian"]'::jsonb, NULL),
    (5,  'antibiotic_pack_auth',    'Antibiotic Pack Authorization','checkbox', true,  NULL, 'I authorize prescription of tactical antibiotic pack for emergency use'),
    (6,  'self_admin_training',     'Self-Administration Training', 'checkbox', true,  NULL, 'I have completed or will complete self-administration training'),
    (7,  'emergency_use_ack',       'Emergency Use Understanding',  'checkbox', true,  NULL, 'I understand these medications are for emergency use only and require provider notification'),
    (8,  'liability_waiver',        'Liability Waiver',             'checkbox', true,  NULL, 'I understand and assume responsibility for proper use of tactical medications'),
    (9,  'signature',               'Participant Signature',        'signature',true,  NULL, NULL)
) AS v(ordinal, field_key, label, mod_type, required, options, description)
WHERE d.brand_key = 'abxtac' AND d.slug = 'services-agreement' AND d.version = 1
ON CONFLICT (form_def_id, field_key) DO NOTHING;

COMMIT;
