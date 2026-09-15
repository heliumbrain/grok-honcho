import { describe, expect, test } from "bun:test";
import plugin from "../plugin.json";
import pkg from "../package.json";
import marketplace from "../.grok-plugin/marketplace.json";
import hooks from "../hooks/hooks.json";
import mcp from "../.mcp.json";
import { existsSync } from "fs";
import { join } from "path";

describe("plugin versions", () => {
  test("marketplace.json matches plugin.json and package.json", () => {
    expect(plugin.version).toBe(pkg.version);
    expect(marketplace.plugins[0]?.version).toBe(plugin.version);
  });

  test("every manifest-referenced dist runtime exists", () => {
    const runtimes = [
      ...Object.values(mcp.mcpServers).flatMap((server) => server.args),
      ...Object.values(hooks.hooks).flatMap((groups) => groups.flatMap((group) =>
        group.hooks.map((hook) => hook.command.match(/dist\/[\w/-]+\.js/)?.[0]),
      )),
    ].filter((value): value is string => typeof value === "string" && value.startsWith("dist/"));

    expect(runtimes.length).toBeGreaterThan(0);
    for (const runtime of runtimes) expect(existsSync(join(import.meta.dir, "..", runtime))).toBe(true);
  });
});
