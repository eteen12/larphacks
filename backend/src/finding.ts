// Local copy of the shared finding shape from #1. Replaced by shared/finding.ts at integration.
export type FindingState = "open" | "approved" | "dismissed";

export interface Finding {
  id: string;
  repo: string;
  pr: number;
  issue: number;
  item: string;
  kind: "conflict" | "no_source";
  issue_quote: string | null;
  note_quote: string | null;
  note_path: string | null;
  note_date: string | null;
  diff_line: string | null;
  confidence: number;
  searches: string[];
  state: FindingState;
}
