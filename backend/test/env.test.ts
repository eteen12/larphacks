import { describe, expect, it } from "vitest";
import { ConfigError, loadEnv, postgresConfig } from "../src/env";

const full = {
  DATABASE_URL: "postgres://u:p@db.example.com/app",
  GITHUB_TOKEN: "t",
  GITHUB_WRITE_TOKEN: "w",
  GITHUB_WEBHOOK_SECRET: "s",
  CLAUDE_CODE_OAUTH_TOKEN: "c",
  FINDINGS_API_KEY: "k",
  DEMO_REPO: "o/demo",
  VAULT_REPO: "o/vault",
};
const prod = { ...full, NODE_ENV: "production" };
const without = (o: Record<string, string>, k: string) => Object.fromEntries(Object.entries(o).filter(([n]) => n !== k));

describe("loadEnv in production", () => {
  it("accepts a complete config with no warning, port defaults to 3000", () => {
    const { env, warning } = loadEnv(prod);
    expect(warning).toBeNull();
    expect(env.production).toBe(true);
    expect(env.port).toBe(3000);
  });

  it("fails naming DATABASE_URL when it is missing", () => {
    expect(() => loadEnv(without(prod, "DATABASE_URL"))).toThrow(/DATABASE_URL/);
  });

  it.each(["GITHUB_TOKEN", "GITHUB_WRITE_TOKEN", "GITHUB_WEBHOOK_SECRET", "DEMO_REPO", "VAULT_REPO", "FINDINGS_API_KEY"])(
    "fails naming %s when it is missing",
    (name) => {
      expect(() => loadEnv(without(prod, name))).toThrow(new RegExp(name));
    },
  );

  it("treats blank values as missing", () => {
    expect(() => loadEnv({ ...prod, GITHUB_TOKEN: "  " })).toThrow(/GITHUB_TOKEN/);
  });

  it("needs a Claude credential, accepts either one", () => {
    const none = without(prod, "CLAUDE_CODE_OAUTH_TOKEN");
    expect(() => loadEnv(none)).toThrow(/CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY/);
    expect(loadEnv({ ...none, ANTHROPIC_API_KEY: "a" }).env.anthropicApiKey).toBe("a");
  });

  it("names every missing value at once, as a ConfigError", () => {
    try {
      loadEnv({ NODE_ENV: "production" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).missing).toEqual(
        expect.arrayContaining(["DATABASE_URL", "GITHUB_TOKEN", "FINDINGS_API_KEY"]),
      );
    }
  });
});

describe("loadEnv locally (NODE_ENV unset)", () => {
  it("allows stubs for missing services with exactly one warning line", () => {
    const { env, warning } = loadEnv({ FINDINGS_API_KEY: "k" });
    expect(env.production).toBe(false);
    expect(env.databaseUrl).toBe("");
    expect(warning).toMatch(/DATABASE_URL/);
    expect(warning).not.toMatch(/\n/);
  });

  it("has no warning when everything is set", () => {
    expect(loadEnv(full).warning).toBeNull();
  });

  it("still requires FINDINGS_API_KEY, which guards the API", () => {
    expect(() => loadEnv(without(full, "FINDINGS_API_KEY"))).toThrow(/FINDINGS_API_KEY/);
  });

  it("rejects a bad PORT and honours a valid one", () => {
    expect(() => loadEnv({ ...full, PORT: "abc" })).toThrow(/PORT/);
    expect(loadEnv({ ...full, PORT: "8080" }).env.port).toBe(8080);
  });
});

describe("postgresConfig", () => {
  it("turns SSL on for a remote host", () => {
    expect(postgresConfig("postgres://u:p@dpg-x.oregon-postgres.render.com/db", {}).ssl).toEqual({ rejectUnauthorized: false });
  });

  it("keeps SSL off for localhost, 127.0.0.1 and ::1 (the local 5433 container)", () => {
    for (const host of ["localhost:5433", "127.0.0.1:5433", "[::1]:5433"]) {
      expect(postgresConfig(`postgres://u:p@${host}/db`, {}).ssl).toBe(false);
    }
  });

  it("turns SSL on for localhost when ?sslmode=require or PGSSLMODE=require", () => {
    expect(postgresConfig("postgres://u:p@localhost/db?sslmode=require", {}).ssl).toBeTruthy();
    expect(postgresConfig("postgres://u:p@localhost/db", { PGSSLMODE: "require" }).ssl).toBeTruthy();
  });

  it("lets sslmode=disable turn it off for a remote host", () => {
    expect(postgresConfig("postgres://u:p@db.example.com/db?sslmode=disable", {}).ssl).toBe(false);
  });

  it("strips sslmode from the connection string", () => {
    expect(postgresConfig("postgres://u:p@db.example.com/db?sslmode=require", {}).connectionString).not.toMatch(/sslmode/);
  });
});
