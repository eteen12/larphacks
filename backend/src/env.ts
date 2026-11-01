export interface Env {
  nodeEnv: string;
  production: boolean;
  githubToken: string;
  githubWriteToken: string;
  githubWebhookSecret: string;
  claudeCodeOauthToken: string;
  anthropicApiKey: string;
  databaseUrl: string;
  demoRepo: string;
  vaultRepo: string;
  findingsApiKey: string;
  frontendOrigin: string;
  port: number;
}

export interface LoadedEnv {
  env: Env;
  /** One line to print at startup, or null. Only ever set outside production. */
  warning: string | null;
}

/** Thrown at startup when production is missing required values. */
export class ConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
    this.name = "ConfigError";
  }
}

/** Required in production. Locally, missing values select a stub and produce one warning. */
const REQUIRED = [
  "DATABASE_URL",
  "GITHUB_TOKEN",
  "GITHUB_WRITE_TOKEN",
  "GITHUB_WEBHOOK_SECRET",
  "DEMO_REPO",
  "VAULT_REPO",
] as const;

/** Required everywhere: it guards /findings/* and /mcp, so there is no stub for it. */
const ALWAYS_REQUIRED = ["FINDINGS_API_KEY"] as const;

const CLAUDE_CREDENTIAL = "CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY";

const SECRET_VARS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "GITHUB_WRITE_TOKEN",
  "GITHUB_WEBHOOK_SECRET",
  "FINDINGS_API_KEY",
] as const;

/**
 * Strips all whitespace from secret env values, in place, so pasted line breaks never reach
 * child processes (the claude CLI rejects a token containing a newline). Returns one log line
 * naming the cleaned variables (never their values), or null when nothing changed.
 */
export function normaliseSecretEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const cleaned: string[] = [];
  for (const name of SECRET_VARS) {
    const value = env[name];
    if (value === undefined) continue;
    const next = value.replace(/\s+/g, "");
    if (next !== value) {
      env[name] = next;
      cleaned.push(name);
    }
  }
  return cleaned.length ? `config: stripped whitespace from ${cleaned.join(", ")}` : null;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): LoadedEnv {
  const get = (name: string) => source[name]?.trim() ?? "";
  const production = source.NODE_ENV === "production";

  const missingAlways: string[] = ALWAYS_REQUIRED.filter((n) => !get(n));
  const missing: string[] = REQUIRED.filter((n) => !get(n));
  if (!get("CLAUDE_CODE_OAUTH_TOKEN") && !get("ANTHROPIC_API_KEY")) missing.push(CLAUDE_CREDENTIAL);

  if (production && (missing.length || missingAlways.length)) {
    throw new ConfigError([...missingAlways, ...missing]);
  }
  if (missingAlways.length) throw new ConfigError(missingAlways);

  const port = get("PORT") ? Number(get("PORT")) : 3000;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError([`PORT (not a valid port: ${get("PORT")})`]);

  return {
    env: {
      nodeEnv: source.NODE_ENV ?? "",
      production,
      githubToken: get("GITHUB_TOKEN"),
      githubWriteToken: get("GITHUB_WRITE_TOKEN"),
      githubWebhookSecret: get("GITHUB_WEBHOOK_SECRET"),
      claudeCodeOauthToken: get("CLAUDE_CODE_OAUTH_TOKEN"),
      anthropicApiKey: get("ANTHROPIC_API_KEY"),
      databaseUrl: get("DATABASE_URL"),
      demoRepo: get("DEMO_REPO"),
      vaultRepo: get("VAULT_REPO"),
      findingsApiKey: get("FINDINGS_API_KEY"),
      frontendOrigin: get("FRONTEND_ORIGIN"),
      port,
    },
    warning: missing.length
      ? `config: ${missing.join(", ")} not set; using local stubs for them (NODE_ENV is not production)`
      : null,
  };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Pool options for DATABASE_URL. SSL is on for any non-local host, or when
 * PGSSLMODE / ?sslmode=require asks for it; off for localhost unless asked.
 * `sslmode` is stripped from the URL so pg does not apply its own stricter
 * verification on top (Render's certificate chain is not in the Node trust store).
 */
export function postgresConfig(
  databaseUrl: string,
  source: NodeJS.ProcessEnv = process.env,
): { connectionString: string; ssl: false | { rejectUnauthorized: false } } {
  const url = new URL(databaseUrl);
  const mode = (url.searchParams.get("sslmode") ?? source.PGSSLMODE ?? "").toLowerCase();
  url.searchParams.delete("sslmode");
  const remote = !LOCAL_HOSTS.has(url.hostname);
  const wantsSsl = ["require", "verify-ca", "verify-full"].includes(mode);
  const ssl = mode === "disable" ? false : wantsSsl || (remote && mode === "") ? { rejectUnauthorized: false as const } : false;
  return { connectionString: url.toString(), ssl };
}
