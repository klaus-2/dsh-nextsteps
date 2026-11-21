// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCALES = ["en", "pt-BR", "zh-CN"];
const BEGIN_MARKER = "// BEGIN GENERATED DICTIONARIES";
const END_MARKER = "// END GENERATED DICTIONARIES";
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function buildTables(localeDir) {
  const tables = {};
  for (const locale of LOCALES) {
    const file = path.join(localeDir, `${locale}.json`);
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch (error) {
      throw new Error(`build-dictionaries: cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`build-dictionaries: ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isPlainObject(parsed)) {
      throw new Error(`build-dictionaries: ${file} must contain a JSON object at its root`);
    }
    if (!isPlainObject(parsed.meta) || typeof parsed.meta.title !== "string" || typeof parsed.meta.description !== "string") {
      throw new Error(`build-dictionaries: ${file} is missing the expected meta structure {title, description}`);
    }
    const table = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key !== "meta") table[key] = value;
    }
    tables[locale] = table;
  }
  return tables;
}

export function renderBlock(tables) {
  if (!isPlainObject(tables)) {
    throw new Error("build-dictionaries: renderBlock expects an object holding the locale tables");
  }
  for (const key of Object.keys(tables)) {
    if (!LOCALES.includes(key)) {
      throw new Error(`build-dictionaries: renderBlock received the unknown table key '${key}' — only ${LOCALES.join(", ")} are accepted`);
    }
  }
  for (const locale of LOCALES) {
    if (!isPlainObject(tables[locale])) {
      throw new Error(`build-dictionaries: renderBlock is missing a plain-object table for '${locale}'`);
    }
  }
  const lines = ["    const DICTIONARIES = {"];
  LOCALES.forEach((locale, index) => {
    const keyText = IDENTIFIER_PATTERN.test(locale) ? locale : `'${locale}'`;
    const comma = index < LOCALES.length - 1 ? "," : "";
    lines.push(`      ${keyText}: ${JSON.stringify(tables[locale])}${comma}`);
  });
  lines.push("    };");
  return lines.join("\n");
}

export function writeClientBlock() {
  const clientPath = path.join(repoRoot(), "client.js");
  const source = readFileSync(clientPath, "utf8");
  const beginCount = source.split(BEGIN_MARKER).length - 1;
  const endCount = source.split(END_MARKER).length - 1;
  if (beginCount === 0) throw new Error(`build-dictionaries: ${clientPath} does not declare the ${BEGIN_MARKER} marker`);
  if (beginCount > 1) throw new Error(`build-dictionaries: ${clientPath} declares ${beginCount} occurrences of ${BEGIN_MARKER} — exactly one is required`);
  if (endCount === 0) throw new Error(`build-dictionaries: ${clientPath} does not declare the ${END_MARKER} marker`);
  if (endCount > 1) throw new Error(`build-dictionaries: ${clientPath} declares ${endCount} occurrences of ${END_MARKER} — exactly one is required`);
  const begin = source.indexOf(BEGIN_MARKER);
  const end = source.indexOf(END_MARKER);
  if (end < begin) throw new Error(`build-dictionaries: ${clientPath} declares ${END_MARKER} before ${BEGIN_MARKER}`);
  const lineStart = (position) => {
    const previous = source.lastIndexOf("\n", position - 1);
    return previous === -1 ? 0 : previous + 1;
  };
  const beginMarkerEnd = begin + BEGIN_MARKER.length;
  const endMarkerLineStart = lineStart(end);
  if (endMarkerLineStart <= begin) throw new Error(`build-dictionaries: ${clientPath} declares both markers on the same line — they must sit on separate lines`);
  const nextNewline = source.indexOf("\n", beginMarkerEnd);
  const beginLineEnd = nextNewline === -1 ? source.length : nextNewline + 1;
  if (beginLineEnd > endMarkerLineStart) throw new Error(`build-dictionaries: ${clientPath} declares both markers on the same line — they must sit on separate lines`);
  const firstNewline = source.indexOf("\n");
  const newline = firstNewline > 0 && source[firstNewline - 1] === "\r" ? "\r\n" : "\n";
  const tables = buildTables(path.join(repoRoot(), "lib", "locale"));
  const block = renderBlock(tables).split("\n").join(newline);
  const updated = source.slice(0, beginLineEnd) + block + newline + source.slice(endMarkerLineStart);
  if (updated === source) return "unchanged";
  writeFileSync(clientPath, updated, "utf8");
  return "written";
}

const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  const status = writeClientBlock();
  console.log(`dsh-nextsteps: dictionaries ${status} in client.js`);
}
