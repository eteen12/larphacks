// Shared finding contract — the shape frozen in issue #1, obeyed by all four features.
// Provisional until Ethan's authoritative copy lands; field names/types are the contract.

export type FindingKind = "conflict" | "no_source";
export type FindingState = "open" | "approved" | "dismissed";

export interface Finding {
  id: string;
  repo: string;
  pr: number;
  issue: number;
  item: string;
  kind: FindingKind;
  issue_quote: string;
  note_quote: string | null;
  note_path: string | null;
  note_date: string | null;
  diff_line: string;
  confidence: number;
  searches: string[];
  state: FindingState;
}

/** Postgres row shape: shared finding + run provenance (#16). */
export interface StoredFinding extends Finding {
  head_sha: string;
  created_at: string;
}
