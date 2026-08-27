import { describe, expect, test } from "bun:test";
import { redactSecrets, validateRedactPattern } from "../src/redact.js";

describe("redactSecrets", () => {
  test("redacts env assignments, flags, headers, URL creds, and token shapes", () => {
    const raw = [
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG",
      "curl --token supersecret https://example.com",
      "Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz0123",
      "https://user:secret@host/path",
      "key hch-abcdefghijklmnopqrstuvwxyz",
    ].join("\n");
    const redacted = redactSecrets(raw);
    expect(redacted).toContain("AWS_SECRET_ACCESS_KEY=***");
    expect(redacted).toContain("--token ***");
    expect(redacted).toContain("Authorization: Bearer ***");
    expect(redacted).toContain("https://user:***@host/path");
    expect(redacted).not.toContain("hch-abcdefghijklmnopqrstuvwxyz");
    expect(redacted).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
  });

  test("applies additive redactPatterns", () => {
    expect(redactSecrets("keep SECRETVAL here", ["SECRETVAL"])).toBe("keep *** here");
  });

  test("skips invalid extra patterns", () => {
    expect(redactSecrets("hello", ["(unclosed"])).toBe("hello");
  });
});

describe("validateRedactPattern", () => {
  test("accepts valid regex and rejects broken ones", () => {
    expect(validateRedactPattern("foo+")).toBeNull();
    expect(validateRedactPattern("(unclosed")).toContain("Invalid regex");
  });
});
