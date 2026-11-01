export type FindingKind = 'conflict' | 'no_source';
export type FindingState = 'open' | 'approved' | 'dismissed';

export type Finding = {
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
};
