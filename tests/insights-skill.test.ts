import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const skill = readFileSync(join(import.meta.dir, "../skills/insights/SKILL.md"), "utf-8");

describe("insights skill", () => {
  test("uses existing Honcho evidence and preserves the explicit approval gate", () => {
    expect(skill).toContain("name: insights");
    expect(skill).toContain("`get_context`");
    expect(skill).toContain("`list_conclusions`");
    expect(skill).toContain("`search`");
    expect(skill).toContain("`schedule_dream`");
    expect(skill).toContain("Durable pattern");
    expect(skill).toContain("One-off context");
    expect(skill).toContain("conclusion ID");
    expect(skill).toContain("secrets");
    expect(skill).toContain("at most five");
    expect(skill).toContain("never edit `AGENTS.md`, configuration, skills, or any other file");
    expect(skill).toContain("explicitly selects a suggestion and confirms the target and change");
  });
});
