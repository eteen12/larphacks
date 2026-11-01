export interface Env {
  githubToken: string;
  githubWebhookSecret: string;
  anthropicApiKey: string;
  databaseUrl: string;
  demoRepo: string;
  vaultRepo: string;
  findingsApiKey: string;
  frontendOrigin: string;
  port: number;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return {
    githubToken: source.GITHUB_TOKEN ?? "",
    githubWebhookSecret: source.GITHUB_WEBHOOK_SECRET ?? "",
    anthropicApiKey: source.ANTHROPIC_API_KEY ?? "",
    databaseUrl: source.DATABASE_URL ?? "",
    demoRepo: source.DEMO_REPO ?? "",
    vaultRepo: source.VAULT_REPO ?? "",
    findingsApiKey: source.FINDINGS_API_KEY ?? "",
    frontendOrigin: source.FRONTEND_ORIGIN ?? "",
    port: Number(source.PORT ?? 3000),
  };
}
