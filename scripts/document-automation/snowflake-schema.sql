-- Document Automation System - Snowflake Schema
-- HIPAA-compliant middleware for automated document ingestion

-- Track all ingested documents
CREATE TABLE IF NOT EXISTS GMH_CLINIC.DOCUMENT_DATA.document_intake (
  id STRING PRIMARY KEY,
  source STRING NOT NULL,  -- 'labgen' or 'intelipacs'
  ingested_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  s3_path STRING NOT NULL,
  s3_bucket STRING DEFAULT 'gmh-documents',
  
  -- Patient demographics (extracted from PDF)
  raw_patient_name STRING,
  raw_patient_dob DATE,
  
  -- Source-specific identifiers
  accession_number STRING,  -- LabGen
  study_uid STRING,         -- InteliPACS
  
  -- Processing status
  status STRING DEFAULT 'pending',  -- 'pending', 'matched', 'uploaded', 'failed'
  healthie_patient_id STRING,
  healthie_document_id STRING,
  error_message STRING,
  
  -- Metadata
  processed_at TIMESTAMP_NTZ,
  created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Patient matching lookup table (cache for speed)
CREATE TABLE IF NOT EXISTS GMH_CLINIC.DOCUMENT_DATA.patient_matches (
  id STRING PRIMARY KEY,
  raw_name STRING NOT NULL,
  raw_dob DATE NOT NULL,
  healthie_patient_id STRING NOT NULL,
  healthie_patient_name STRING,
  confidence_score FLOAT,  -- 0.0 to 1.0
  verified_by STRING,      -- 'auto' or user email
  verified_at TIMESTAMP_NTZ,
  created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  
  -- Composite unique constraint
  UNIQUE (raw_name, raw_dob)
);

-- AI analysis results
CREATE TABLE IF NOT EXISTS GMH_CLINIC.DOCUMENT_DATA.ai_analysis_results (
  id STRING PRIMARY KEY,
  document_intake_id STRING NOT NULL,
  severity_level INTEGER NOT NULL,  -- 1-5
  findings_summary STRING,
  critical_values VARIANT,  -- JSON array of abnormal values
  recommended_action STRING,
  ai_confidence FLOAT,
  ai_model STRING DEFAULT 'claude-3.5-sonnet',
  analyzed_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  
  FOREIGN KEY (document_intake_id) REFERENCES GMH_CLINIC.DOCUMENT_DATA.document_intake(id)
);

-- Alert/notification history (de-duplication and fatigue prevention)
CREATE TABLE IF NOT EXISTS GMH_CLINIC.DOCUMENT_DATA.alert_history (
  id STRING PRIMARY KEY,
  document_intake_id STRING NOT NULL,
  alert_type STRING NOT NULL,  -- 'google_chat', 'telegram', 'digest'
  severity_level INTEGER NOT NULL,
  channel STRING,  -- 'critical', 'review_queue', 'trends'
  message_id STRING,  -- Google Chat message ID
  sent_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  acknowledged_by STRING,
  acknowledged_at TIMESTAMP_NTZ,
  
  FOREIGN KEY (document_intake_id) REFERENCES GMH_CLINIC.DOCUMENT_DATA.document_intake(id)
);

-- HIPAA audit log (comprehensive tracking)
CREATE TABLE IF NOT EXISTS GMH_CLINIC.DOCUMENT_DATA.audit_log (
  id STRING PRIMARY KEY,
  event_type STRING NOT NULL,  -- 'document_ingested', 'patient_matched', 'alert_sent', 'document_uploaded', 'manual_review'
  document_intake_id STRING,
  user_email STRING,
  action STRING NOT NULL,
  details VARIANT,  -- JSON object with event-specific details
  ip_address STRING,
  user_agent STRING,
  timestamp TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  
  FOREIGN KEY (document_intake_id) REFERENCES GMH_CLINIC.DOCUMENT_DATA.document_intake(id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_document_intake_status 
  ON GMH_CLINIC.DOCUMENT_DATA.document_intake(status);
  
CREATE INDEX IF NOT EXISTS idx_document_intake_patient 
  ON GMH_CLINIC.DOCUMENT_DATA.document_intake(healthie_patient_id);
  
CREATE INDEX IF NOT EXISTS idx_patient_matches_lookup 
  ON GMH_CLINIC.DOCUMENT_DATA.patient_matches(raw_name, raw_dob);
  
CREATE INDEX IF NOT EXISTS idx_alert_history_patient_time 
  ON GMH_CLINIC.DOCUMENT_DATA.alert_history(document_intake_id, sent_at);

-- Create schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS GMH_CLINIC.DOCUMENT_DATA;

COMMENT ON TABLE GMH_CLINIC.DOCUMENT_DATA.document_intake IS 'Tracks all ingested lab and imaging documents from LabGen and InteliPACS';
COMMENT ON TABLE GMH_CLINIC.DOCUMENT_DATA.patient_matches IS 'Caches patient matching results for faster lookup and consistency';
COMMENT ON TABLE GMH_CLINIC.DOCUMENT_DATA.ai_analysis_results IS 'Stores AI severity analysis for all documents';
COMMENT ON TABLE GMH_CLINIC.DOCUMENT_DATA.alert_history IS 'Tracks all alerts sent to prevent duplicates and measure response times';
COMMENT ON TABLE GMH_CLINIC.DOCUMENT_DATA.audit_log IS 'HIPAA-compliant audit trail for all document processing activities';
