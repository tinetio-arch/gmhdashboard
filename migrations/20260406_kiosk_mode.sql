-- Patient Kiosk Mode tables
-- Enables staff to lock iPad for patient form-filling with PIN unlock

-- Kiosk PIN configuration (one per clinic)
CREATE TABLE IF NOT EXISTS kiosk_config (
    config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_hash TEXT NOT NULL,
    set_by TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit trail for every kiosk form session
CREATE TABLE IF NOT EXISTS kiosk_form_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(patient_id),
    healthie_patient_id TEXT NOT NULL,
    form_id TEXT NOT NULL,
    form_name TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    submitted_to_healthie BOOLEAN DEFAULT FALSE,
    healthie_form_answer_group_id TEXT,
    signature_captured BOOLEAN DEFAULT FALSE,
    ip_address TEXT,
    user_agent TEXT,
    device_info JSONB,
    initiated_by TEXT NOT NULL,
    unlocked_by TEXT,
    status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','abandoned','error')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kiosk_sessions_patient ON kiosk_form_sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_kiosk_sessions_status ON kiosk_form_sessions(status);
CREATE INDEX IF NOT EXISTS idx_kiosk_sessions_created ON kiosk_form_sessions(created_at);
