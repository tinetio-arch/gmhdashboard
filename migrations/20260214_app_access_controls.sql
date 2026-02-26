-- App Access Control System
-- Migration: 20260214_app_access_controls.sql
-- Purpose: Track patient app access decisions with full audit trail

CREATE TABLE IF NOT EXISTS app_access_controls (
    id                  SERIAL PRIMARY KEY,
    patient_id          UUID NOT NULL REFERENCES patients(patient_id),
    healthie_client_id  TEXT,
    access_status       VARCHAR(20) NOT NULL DEFAULT 'granted'
                        CHECK (access_status IN ('granted', 'revoked', 'suspended')),
    reason              TEXT NOT NULL,
    reason_category     VARCHAR(50)
                        CHECK (reason_category IN ('payment', 'policy_violation', 'discharged', 'administrative', 'other')),
    changed_by          UUID REFERENCES users(user_id),
    healthie_synced     BOOLEAN DEFAULT FALSE,
    healthie_sync_error TEXT,
    effective_at        TIMESTAMPTZ DEFAULT NOW(),
    expires_at          TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aac_patient_id ON app_access_controls(patient_id);
CREATE INDEX IF NOT EXISTS idx_aac_status ON app_access_controls(access_status);
CREATE INDEX IF NOT EXISTS idx_aac_effective_at ON app_access_controls(effective_at DESC);
