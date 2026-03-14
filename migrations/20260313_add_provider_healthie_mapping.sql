-- Migration: Add Healthie provider ID mapping to users table
-- Allows providers to see their own schedule when logged in to iPad

ALTER TABLE users
ADD COLUMN IF NOT EXISTS healthie_provider_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_users_healthie_provider
ON users(healthie_provider_id)
WHERE healthie_provider_id IS NOT NULL;

-- Set known provider IDs based on SOT
-- Phil Schafer NP: 12088269
-- Dr. Aaron Whitten: 12093125

-- Example update (uncomment and adjust email to match actual user emails):
-- UPDATE users SET healthie_provider_id = '12093125' WHERE email = 'aaron@nowoptimal.com' OR email = 'dr.whitten@nowoptimal.com';
-- UPDATE users SET healthie_provider_id = '12088269' WHERE email = 'phil@nowoptimal.com' OR email = 'phil.schafer@nowoptimal.com';

COMMENT ON COLUMN users.healthie_provider_id IS 'Healthie provider ID for schedule filtering and appointment management';
