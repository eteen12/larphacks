import fixtures from '@/data/fake-findings.json';
import type { Finding } from '@/types/finding';

export type ApiError = {
  kind: 'network' | 'unauthorized' | 'server' | 'already-handled' | 'invalid';
  message: string;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export type ApiConfig = { baseUrl?: string; apiKey?: string };

// Expo inlines EXPO_PUBLIC_ values at build time, so tests pass their own config.
const envConfig: ApiConfig = {
  baseUrl: process.env.EXPO_PUBLIC_API_URL,
  apiKey: process.env.EXPO_PUBLIC_FINDINGS_API_KEY,
};

// Fake mode only: ids decided since the app started, hidden from the next load.
const decidedInFakeMode = new Set<string>();

export function resetFakeDecisions() {
  decidedInFakeMode.clear();
}

// The Finding shape has no timestamp, so a higher PR number counts as newer.
function newestFirst(findings: Finding[]) {
  return [...findings].sort((a, b) => b.pr - a.pr);
}

// Fake mode only: start an instruction or note with one of these to force that failure.
function forcedFakeFailure(text: unknown): ApiResult<never> | null {
  if (typeof text !== 'string') return null;
  if (text.startsWith('!offline')) return fail('network', 'Could not reach the server.');
  if (text.startsWith('!fail')) return fail('server', 'The server returned 502.');
  if (text.startsWith('!conflict')) return fail('already-handled', 'Already handled.');
  return null;
}

function fail(kind: ApiError['kind'], message: string): ApiResult<never> {
  return { ok: false, error: { kind, message } };
}

async function request(
  { baseUrl, apiKey }: ApiConfig,
  path: string,
  body?: object,
): Promise<ApiResult<Response>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl?.replace(/\/+$/, '')}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'x-api-key': apiKey ?? '',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    return fail('network', 'Could not reach the server.');
  }

  if (response.ok) return { ok: true, data: response };
  if (response.status === 401) return fail('unauthorized', 'The API key was rejected.');
  if (response.status === 409) return fail('already-handled', 'Already handled.');
  if (response.status === 400) return fail('invalid', 'The server rejected that request.');
  return fail('server', `The server returned ${response.status}.`);
}

export async function fetchOpenFindings(
  config: ApiConfig = envConfig,
): Promise<ApiResult<Finding[]>> {
  if (!config.baseUrl) {
    const open = (fixtures as Finding[]).filter(
      (f) => f.state === 'open' && !decidedInFakeMode.has(f.id),
    );
    return { ok: true, data: newestFirst(open) };
  }

  const result = await request(config, '/findings?state=open');
  if (!result.ok) return result;

  try {
    return { ok: true, data: newestFirst((await result.data.json()) as Finding[]) };
  } catch {
    return fail('server', 'The server sent an invalid response.');
  }
}

async function decide(
  config: ApiConfig,
  id: string,
  action: 'approve' | 'dismiss',
  body: object,
): Promise<ApiResult<void>> {
  if (!config.baseUrl) {
    const forced = forcedFakeFailure(Object.values(body)[0]);
    if (forced) return forced;
    if (decidedInFakeMode.has(id)) return fail('already-handled', 'Already handled.');
    decidedInFakeMode.add(id);
    return { ok: true, data: undefined };
  }

  const result = await request(config, `/findings/${encodeURIComponent(id)}/${action}`, body);
  return result.ok ? { ok: true, data: undefined } : result;
}

export async function approveFinding(
  id: string,
  instruction: string,
  config: ApiConfig = envConfig,
): Promise<ApiResult<void>> {
  if (!instruction.trim()) return fail('invalid', 'Add an instruction before approving.');
  return decide(config, id, 'approve', { instruction });
}

export async function dismissFinding(
  id: string,
  note?: string,
  config: ApiConfig = envConfig,
): Promise<ApiResult<void>> {
  return decide(config, id, 'dismiss', { note });
}
