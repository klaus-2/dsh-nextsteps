import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const suiteDir = path.join(here, "suite");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
export const pluginId = pkg.name;
export const isDevCopy = pluginId.endsWith("-dev");

export const results = [];
let currentSuite = "";

export function suite(name) {
  currentSuite = name;
  results.push({ suite: name, cases: [] });
}

export function test(name, fn) {
  const entry = results.at(-1);
  const caseEntry = { name, ok: true, error: undefined };
  entry.cases.push(caseEntry);
  try {
    const outcome = fn();
    if (outcome && typeof outcome.then === "function") {
      return outcome.then(
        () => {},
        (error) => {
          caseEntry.ok = false;
          caseEntry.error = error;
        }
      );
    }
  } catch (error) {
    caseEntry.ok = false;
    caseEntry.error = error;
  }
  return undefined;
}

export function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

export function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message ?? "values differ"}\n  expected: ${b}\n  actual:   ${a}`);
}

export function assertIncludes(haystack, needle, message) {
  if (!String(haystack).includes(needle)) {
    throw new Error(`${message ?? "missing substring"}: ${JSON.stringify(String(haystack).slice(0, 220))} does not include ${JSON.stringify(needle)}`);
  }
}

export function assertMatch(value, pattern, message) {
  if (!pattern.test(String(value))) {
    throw new Error(`${message ?? "pattern mismatch"}: ${JSON.stringify(String(value).slice(0, 220))} does not match ${pattern}`);
  }
}

export function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message ?? "expected a throw");
}

export async function run() {
  const files = readdirSync(suiteDir).filter((name) => name.endsWith(".test.mjs")).sort();
  for (const file of files) {
    await import(pathToFileURL(path.join(suiteDir, file)).href);
  }
  let passed = 0;
  let failed = 0;
  for (const entry of results) {
    const failures = entry.cases.filter((item) => !item.ok);
    passed += entry.cases.length - failures.length;
    failed += failures.length;
    const mark = failures.length === 0 ? "PASS" : "FAIL";
    console.log(`${mark}  ${entry.suite} (${entry.cases.length - failures.length}/${entry.cases.length})`);
    for (const item of failures) {
      const detail = item.error instanceof Error ? item.error.message : String(item.error);
      console.log(`      ✗ ${item.name}`);
      for (const line of detail.split("\n")) console.log(`        ${line}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}
