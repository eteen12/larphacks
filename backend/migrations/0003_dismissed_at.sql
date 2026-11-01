-- When a finding was dismissed; read by the check workspace's github/decisions.md (#54).
ALTER TABLE findings ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;
