-- Note fields are string | null in shared/finding.ts: a finding with no vault note stores NULL, not ''.
ALTER TABLE findings ALTER COLUMN note_quote DROP NOT NULL;
ALTER TABLE findings ALTER COLUMN note_quote DROP DEFAULT;
ALTER TABLE findings ALTER COLUMN note_path DROP NOT NULL;
ALTER TABLE findings ALTER COLUMN note_path DROP DEFAULT;
ALTER TABLE findings ALTER COLUMN note_date DROP NOT NULL;
ALTER TABLE findings ALTER COLUMN note_date DROP DEFAULT;
UPDATE findings SET note_quote = NULL WHERE note_quote = '';
UPDATE findings SET note_path = NULL WHERE note_path = '';
UPDATE findings SET note_date = NULL WHERE note_date = '';
