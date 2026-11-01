import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify an X-Hub-Signature-256 header against the raw request body. */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null | undefined,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const actual = signatureHeader.slice("sha256=".length);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(actual, "utf8"));
}
