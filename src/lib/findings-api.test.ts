import {
  approveFinding,
  dismissFinding,
  fetchOpenFindings,
  resetFakeDecisions,
} from '@/lib/findings-api';
import type { Finding } from '@/types/finding';

function finding(id: string, pr: number): Finding {
  return {
    id,
    repo: 'demo/repo',
    pr,
    issue: 1,
    item: 'x',
    kind: 'conflict',
    issue_quote: 'a',
    note_quote: 'b',
    note_path: 'n.md',
    note_date: '2026-10-01',
    diff_line: 'c',
    confidence: 0.9,
    searches: [],
    state: 'open',
  };
}

const api = { baseUrl: 'https://api.test', apiKey: 'k' };

function mockFetch(impl: () => Promise<Partial<Response>>) {
  const fn = jest.fn(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(resetFakeDecisions);

describe('fetchOpenFindings', () => {
  it('uses fixtures when no API URL is set', async () => {
    const fn = mockFetch(async () => ({}));

    const result = await fetchOpenFindings({});

    expect(fn).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.every((f) => f.state === 'open')).toBe(true);
    }
  });

  it('calls the API with the key and returns findings newest first', async () => {
    const fn = mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => [finding('a', 3), finding('b', 9), finding('c', 5)],
    }));

    const result = await fetchOpenFindings({ baseUrl: 'https://api.test/', apiKey: 'secret' });

    expect(fn).toHaveBeenCalledWith('https://api.test/findings?state=open', {
      method: 'GET',
      headers: { 'x-api-key': 'secret' },
    });
    expect(result).toEqual({
      ok: true,
      data: [finding('b', 9), finding('c', 5), finding('a', 3)],
    });
  });

  it('returns an empty array, not an error, for an empty list', async () => {
    mockFetch(async () => ({ ok: true, status: 200, json: async () => [] }));

    expect(await fetchOpenFindings(api)).toEqual({ ok: true, data: [] });
  });

  it('returns unauthorized on HTTP 401', async () => {
    mockFetch(async () => ({ ok: false, status: 401 }));

    const result = await fetchOpenFindings(api);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('unauthorized');
  });

  it('returns network when the request fails', async () => {
    mockFetch(async () => {
      throw new TypeError('Network request failed');
    });

    const result = await fetchOpenFindings(api);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('network');
  });

  it('returns server on other HTTP errors', async () => {
    mockFetch(async () => ({ ok: false, status: 500 }));

    const result = await fetchOpenFindings(api);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('server');
  });
});

describe('approveFinding', () => {
  it('posts the instruction with the key', async () => {
    const fn = mockFetch(async () => ({ ok: true, status: 200 }));

    const result = await approveFinding('f1', 'Use 30 days', { baseUrl: 'https://api.test/', apiKey: 'secret' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(fn).toHaveBeenCalledWith('https://api.test/findings/f1/approve', {
      method: 'POST',
      headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
      body: JSON.stringify({ instruction: 'Use 30 days' }),
    });
  });

  it('rejects an empty instruction without sending a request', async () => {
    const fn = mockFetch(async () => ({ ok: true, status: 200 }));

    const result = await approveFinding('f1', '   ', api);

    expect(fn).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid');
  });

  it.each([
    [409, 'already-handled'],
    [401, 'unauthorized'],
    [400, 'invalid'],
    [502, 'server'],
    [500, 'server'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    mockFetch(async () => ({ ok: false, status }));

    const result = await approveFinding('f1', 'Use 30 days', api);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(kind);
  });

  it('returns network when the request fails', async () => {
    mockFetch(async () => {
      throw new TypeError('Network request failed');
    });

    const result = await approveFinding('f1', 'Use 30 days', api);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('network');
  });
});

describe('dismissFinding', () => {
  it('posts the note, and allows no note', async () => {
    const fn = mockFetch(async () => ({ ok: true, status: 200 }));

    expect(await dismissFinding('f2', 'Not a conflict', api)).toEqual({ ok: true, data: undefined });
    expect(fn).toHaveBeenCalledWith('https://api.test/findings/f2/dismiss', {
      method: 'POST',
      headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'Not a conflict' }),
    });
    expect(await dismissFinding('f2', undefined, api)).toEqual({ ok: true, data: undefined });
  });

  it('maps 409 to already-handled', async () => {
    mockFetch(async () => ({ ok: false, status: 409 }));

    const result = await dismissFinding('f2', undefined, api);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('already-handled');
  });
});

describe('fake mode decisions', () => {
  it('hides a decided finding from the next load', async () => {
    const before = await fetchOpenFindings({});
    if (!before.ok) throw new Error('expected fixtures');
    const id = before.data[0].id;

    expect(await approveFinding(id, 'Use 30 days', {})).toEqual({ ok: true, data: undefined });

    const after = await fetchOpenFindings({});
    if (!after.ok) throw new Error('expected fixtures');
    expect(after.data.map((f) => f.id)).not.toContain(id);
    expect(after.data).toHaveLength(before.data.length - 1);
  });

  it('reports already-handled when a finding is decided twice', async () => {
    await dismissFinding('f1', undefined, {});

    const result = await dismissFinding('f1', undefined, {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('already-handled');
  });
});
