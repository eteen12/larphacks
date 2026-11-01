import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./signature.js";

const SECRET = "test-secret";
const BODY = '{"action":"opened"}';

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("verifyWebhookSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(SECRET, BODY, sign(SECRET, BODY))).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(verifyWebhookSignature(SECRET, BODY, sign("other-secret", BODY))).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifyWebhookSignature(SECRET, BODY, null)).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, undefined)).toBe(false);
  });

  it("rejects a malformed signature header", () => {
    expect(verifyWebhookSignature(SECRET, BODY, "deadbeef")).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, "sha1=abc")).toBe(false);
  });

  it("rejects a signature computed over a different body", () => {
    expect(verifyWebhookSignature(SECRET, `${BODY} `, sign(SECRET, BODY))).toBe(false);
  });
});
