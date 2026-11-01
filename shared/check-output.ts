// The agent's three-part answer, agreed between #5's check prompt and #2's validator.
// Provisional until Ethan's authoritative copy lands.

export interface CheckDecision {
  item: string;
  source: string;
  quote: string;
  date: string | null;
}

export interface CheckCode {
  item: string;
  file: string;
  line: string;
  does: string;
}

/** A finding as the agent emits it — repo/pr/issue/state/searches are stamped by the pipeline. */
export interface AgentFinding {
  item: string;
  kind: "conflict" | "no_source";
  issue_quote: string;
  note_quote: string;
  note_path: string;
  note_date: string;
  diff_line: string;
  confidence: number;
}

export interface CheckOutput {
  decisions: CheckDecision[];
  code: CheckCode[];
  findings: AgentFinding[];
}
