import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { suite, test, assert, assertEqual, assertIncludes } from "../harness.mjs";
import { root } from "../client-harness.mjs";
import { buildTables, renderBlock } from "../build-dictionaries.mjs";

const localeDir = path.join(root, "lib", "locale");
const localeFiles = ["en", "pt-BR", "zh-CN"].map((lang) => ({
  lang,
  data: JSON.parse(readFileSync(path.join(localeDir, `${lang}.json`), "utf8"))
}));

suite("dictionaries: generator tables and inline block rendering");

test("buildTables returns exactly the three non-meta key sets of the locale files", () => {
  const tables = buildTables(localeDir);
  assertEqual(Object.keys(tables), ["en", "pt-BR", "zh-CN"], "the tables cover exactly the three locales");
  for (const { lang, data } of localeFiles) {
    const expected = Object.keys(data).filter((key) => key !== "meta");
    assertEqual(Object.keys(tables[lang]), expected, `${lang} carries the file's non-meta keys in insertion order`);
    assert(!("meta" in tables[lang]), `${lang} excludes meta from the table`);
  }
});

test("buildTables keeps exact spot-check values from the real locale files", () => {
  const tables = buildTables(localeDir);
  assertEqual(tables.en.header, localeFiles[0].data.header, "en keeps the real header value");
  assertEqual(tables.en.setLanguageTip, localeFiles[0].data.setLanguageTip, "en keeps the real setLanguageTip value");
  assertEqual(tables["pt-BR"].setLanguageTip, localeFiles[1].data.setLanguageTip, "pt-BR keeps the real setLanguageTip value");
  assertEqual(tables["pt-BR"].update, localeFiles[1].data.update, "pt-BR keeps the real update value");
  assertEqual(tables["zh-CN"].header, localeFiles[2].data.header, "zh-CN keeps the real header value");
  assertEqual(tables["zh-CN"].favorites, localeFiles[2].data.favorites, "zh-CN keeps the real favorites value");
});

test("renderBlock is deterministic across consecutive calls", () => {
  const tables = buildTables(localeDir);
  assertEqual(renderBlock(tables), renderBlock(tables), "two renders are byte-identical");
  const rendered = renderBlock(tables);
  assert(!rendered.endsWith("\n"), "the block carries no trailing newline beyond itself");
});

test("renderBlock quotes non-identifier keys and leaves en bare", () => {
  const block = renderBlock(buildTables(localeDir));
  assertIncludes(block, "\n      en: {", "en appears unquoted as a bare identifier");
  assertIncludes(block, "\n      'pt-BR': {", "pt-BR is single-quoted");
  assertIncludes(block, "\n      'zh-CN': {", "zh-CN is single-quoted");
  assert(!block.includes('en: "'), "en is never quoted");
});

test("renderBlock changes when one table value drifts", () => {
  const tables = buildTables(localeDir);
  const baseline = renderBlock(tables);
  const drifted = { ...tables, en: { ...tables.en, header: "A different header" } };
  assert(renderBlock(drifted) !== baseline, "a mutated value changes the rendered block");
});

test("renderBlock uses the exact 4/6-space indentation and the }; closing", () => {
  const block = renderBlock(buildTables(localeDir));
  const lines = block.split("\n");
  assertEqual(lines.length, 5, "the block holds the opener, three entries and the closer");
  assertEqual(lines[0], "    const DICTIONARIES = {", "the opener is indented with exactly four spaces");
  assert(lines[1].startsWith("      en: "), "the en entry is indented with exactly six spaces");
  assert(lines[2].startsWith("      'pt-BR': "), "the pt-BR entry is indented with exactly six spaces");
  assert(lines[3].startsWith("      'zh-CN': "), "the zh-CN entry is indented with exactly six spaces");
  assert(lines[1].endsWith(","), "the en entry carries a comma");
  assert(lines[2].endsWith(","), "the pt-BR entry carries a comma");
  assert(!lines[3].endsWith(","), "the zh-CN entry carries no trailing comma");
  assertEqual(lines[4], "    };", "the closer is indented with exactly four spaces");
});

test("renderBlock hard-fails on unknown table keys", () => {
  const tables = buildTables(localeDir);
  let message = "";
  try {
    renderBlock({ ...tables, fr: {} });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertIncludes(message, "fr", "the error names the unknown key");
  assertIncludes(message, "only en, pt-BR, zh-CN", "the error names the accepted keys");
});

test("buildTables hard-fails with the parse detail on an invalid JSON fixture", () => {
  const brokenDir = mkdtempSync(path.join(tmpdir(), "dictionaries-broken-"));
  try {
    writeFileSync(path.join(brokenDir, "en.json"), '{"header": "oops"', "utf8");
    writeFileSync(path.join(brokenDir, "pt-BR.json"), "{}", "utf8");
    writeFileSync(path.join(brokenDir, "zh-CN.json"), "{}", "utf8");
    let message = "";
    try {
      buildTables(brokenDir);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assertIncludes(message, "not valid JSON", "the error names the invalid JSON");
    assertIncludes(message, "en.json", "the error names the failing file");
  } finally {
    rmSync(brokenDir, { recursive: true, force: true });
  }
});
