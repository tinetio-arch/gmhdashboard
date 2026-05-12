-- Agent Action Log
-- Stores all actions taken by Claude Code scheduled agents
-- CEO iPad dashboard reads from this table for "Needs Decision" and "Agent Activity" cards

CREATE TABLE IF NOT EXISTS agent_action_log (
    id SERIAL PRIMARY KEY,
    agent_name VARCHAR(50) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    category VARCHAR(50),
    summary TEXT NOT NULL,
    details JSONB,
    status VARCHAR(20) DEFAULT 'completed',
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE agent_action_log IS 'Tracks all Claude Code agent actions — auto-fixes, escalations, monitoring results';
COMMENT ON COLUMN agent_action_log.agent_name IS 'morning_intelligence, data_integrity, system_monitor';
COMMENT ON COLUMN agent_action_log.action_type IS 'auto_fix, needs_decision, info, error, health_check';
COMMENT ON COLUMN agent_action_log.category IS 'patient_sync, inventory, billing, system_health, labs, ghl_sync';
COMMENT ON COLUMN agent_action_log.status IS 'completed, needs_decision, resolved, dismissed';

CREATE INDEX IF NOT EXISTS idx_agent_log_needs_decision
    ON agent_action_log(status) WHERE status = 'needs_decision';

CREATE INDEX IF NOT EXISTS idx_agent_log_created
    ON agent_action_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_log_agent_date
    ON agent_action_log(agent_name, created_at DESC);
