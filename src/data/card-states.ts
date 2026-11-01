import fixtures from '@/data/fake-findings.json';
import type { Finding } from '@/types/finding';

export type CardState = { label: string; finding: Finding };

const base = (fixtures as Finding[])[0];

const longQuote =
  'The client said that refunds must be allowed for 30 days after purchase, no exceptions, ' +
  'including for sale items, gift cards that were already redeemed, and orders placed through ' +
  'the partner marketplace, and that support should never ask the customer to justify the request.';

const longDiff =
  'const REFUND_WINDOW_DAYS = order.isSaleItem || order.channel === "partner" ? 7 : order.giftCardRedeemed ? 0 : 14;';

// Edge cases from #39, shown next to every fixture on the dev page.
const edgeCases: CardState[] = [
  { label: 'Edge: very long client quote', finding: { ...base, id: 'edge-long-quote', note_quote: longQuote } },
  { label: 'Edge: very long diff line', finding: { ...base, id: 'edge-long-diff', diff_line: longDiff } },
  { label: 'Edge: missing note date', finding: { ...base, id: 'edge-no-date', note_date: null } },
  {
    label: 'Edge: no source',
    finding: {
      ...base,
      id: 'edge-no-source',
      kind: 'no_source',
      note_quote: null,
      note_path: null,
      note_date: null,
    },
  },
];

export const cardStates: CardState[] = [
  ...(fixtures as Finding[]).map((finding) => ({
    label: `Fixture ${finding.id}: ${finding.item}`,
    finding,
  })),
  ...edgeCases,
];
