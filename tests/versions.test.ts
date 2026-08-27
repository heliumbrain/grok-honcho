import { describe, expect, test } from "bun:test";
import plugin from "../plugin.json";
import pkg from "../package.json";
import marketplace from "../.grok-plugin/marketplace.json";

describe("plugin versions", () => {
  test("marketplace.json matches plugin.json and package.json", () => {
    expect(plugin.version).toBe(pkg.version);
    expect(marketplace.plugins[0]?.version).toBe(plugin.version);
  });
});
