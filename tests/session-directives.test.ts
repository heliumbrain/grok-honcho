import { describe, expect, test } from "bun:test";
import { honchoDirectives } from "../src/hooks/session-start.js";

describe("session-start directives", () => {
  test("default recall path names chat/search", () => {
    const text = honchoDirectives("alice-myapp", false);
    expect(text).toContain("session=alice-myapp");
    expect(text).toContain("`chat` or `search`");
    expect(text).not.toContain("honcho_remember");
  });

  test("rememberTool names honcho_remember as the primary recall path", () => {
    const text = honchoDirectives("alice-myapp", true);
    expect(text).toContain("`honcho_remember`");
    expect(text).toContain("batch several focused questions");
    expect(text).not.toContain("`chat` or `search` mid-conversation");
  });
});
