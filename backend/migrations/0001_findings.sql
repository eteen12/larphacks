CREATE TABLE IF NOT EXISTS findings (
  id uuid PRIMARY KEY,
  repo text NOT NULL,
  pr int NOT NULL,
  issue int NOT NULL,
  item text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('conflict', 'no_source')),
  issue_quote text NOT NULL DEFAULT '',
  note_quote text NOT NULL DEFAULT '',
  note_path text NOT NULL DEFAULT '',
  note_date text NOT NULL DEFAULT '',
  diff_line text NOT NULL DEFAULT '',
  confidence double precision NOT NULL,
  searches jsonb NOT NULL DEFAULT '[]',
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'approved', 'dismissed')),
  head_sha text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS findings_repo_pr_state ON findings (repo, pr, state, created_at DESC);

-- finished runs per PR, for the stale-run discard rule
CREATE TABLE IF NOT EXISTS check_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repo text NOT NULL,
  pr int NOT NULL,
  head_sha text NOT NULL,
  enqueued_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('done'))
);

CREATE INDEX IF NOT EXISTS check_runs_repo_pr ON check_runs (repo, pr, enqueued_at);

-- one row per (repo, pr); the upsert's row lock serializes concurrent save txs
CREATE TABLE IF NOT EXISTS pr_runs (
  repo text NOT NULL,
  pr int NOT NULL,
  last_enqueued_at timestamptz NOT NULL,
  PRIMARY KEY (repo, pr)
);
