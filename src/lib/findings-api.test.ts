import { fetchOpenFindings } from '@/lib/findings-api';
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
