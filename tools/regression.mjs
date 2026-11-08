import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHarness } from "./lib/harness.mjs";
import { runHostSuite } from "./lib/host-suite.mjs";
import { runClientSuite } from "./lib/client-suite.mjs";
import { runPackageSuite } from "./lib/package-suite.mjs";

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harness = createHarness({ title: "dsh-nextsteps regression" });

const suites = [
  ["host", () => runHostSuite(harness, { pluginDir })],
  ["client", () => runClientSuite(harness, { pluginDir })],
  ["package", () => runPackageSuite(harness, { pluginDir, packageName: "dsh-nextsteps" })]
];

for (const [name, run] of suites) {
  try {
    await run();
  } catch (error) {
    harness.check(`the ${name} suite ran to the end`, false, String(error?.stack ?? error).split("\n").slice(0, 3).join(" | "));
  }
}

process.exit(harness.report());
