import fixtures from '@/data/fake-findings.json';
import type { Finding } from '@/types/finding';

export type ApiError = {
  kind: 'network' | 'unauthorized' | 'server';
  message: string;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

// The Finding shape has no timestamp, so a higher PR number counts as newer.
function newestFirst(findings: Finding[]) {
  return [...findings].sort((a, b) => b.pr - a.pr);
}

export type ApiConfig = { baseUrl?: string; apiKey?: string };

// Expo inlines EXPO_PUBLIC_ values at build time, so tests pass their own config.
const envConfig: ApiConfig = {
  baseUrl: process.env.EXPO_PUBLIC_API_URL,
  apiKey: process.env.EXPO_PUBLIC_FINDINGS_API_KEY,
};

export async function fetchOpenFindings(
  { baseUrl, apiKey }: ApiConfig = envConfig,
): Promise<ApiResult<Finding[]>> {
  if (!baseUrl) {
    const open = (fixtures as Finding[]).filter((f) => f.state === 'open');
    return { ok: true, data: newestFirst(open) };
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}/findings?state=open`, {
      headers: { 'x-api-key': apiKey ?? '' },
    });
  } catch {
    return { ok: false, error: { kind: 'network', message: 'Could not reach the server.' } };
  }

  if (response.status === 401) {
    return { ok: false, error: { kind: 'unauthorized', message: 'The API key was rejected.' } };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: { kind: 'server', message: `The server returned ${response.status}.` },
    };
  }

  try {
    return { ok: true, data: newestFirst((await response.json()) as Finding[]) };
  } catch {
    return { ok: false, error: { kind: 'server', message: 'The server sent an invalid response.' } };
  }
}
