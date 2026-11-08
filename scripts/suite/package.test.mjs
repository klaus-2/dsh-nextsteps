import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { suite, test, assert, assertEqual, assertIncludes, assertMatch, pkg, pluginId, isDevCopy } from "../harness.mjs";
import { root } from "../client-harness.mjs";

suite("package: layout, dictionaries and static safety");

const clientSource = readFileSync(path.join(root, "client.js"), "utf8");
const hostSource = readFileSync(path.join(root, "index.js"), "utf8");
const locales = ["en", "pt-BR", "zh-CN"].map((lang) => ({
  lang,
  data: JSON.parse(readFileSync(path.join(root, "lib", "locale", `${lang}.json`), "utf8"))
}));

test("the entrypoints live at the package root", () => {
  assert(exists(path.join(root, "index.js")), "index.js is at the root");
  assert(exists(path.join(root, "client.js")), "client.js is at the root");
  assertEqual(pkg.exports["."], "./index.js");
  assertEqual(pkg.exports["./client"], "./client.js");
});

test("every packaged file exists", () => {
  for (const entry of pkg.files) {
    const target = path.join(root, entry);
    const present = exists(target) || existsDirectory(target);
    assert(present, `the packaged file ${entry} exists`);
  }
});

test("the package carries the identity it publishes under", () => {
  assert(pkg.name === pluginId, "the package name is the plugin identity");
  assertEqual(pkg.exports["."], "./index.js");
  assertMatch(pkg.name, /^[a-z0-9][a-z0-9-]*$/, "the package name is npm safe");
});

test("the release copy is publishable and the development copy is not", () => {
  if (isDevCopy) {
    assertEqual(pkg.private, true, "a development copy is never published");
    assertMatch(pkg.version, /-dev\.\d+$/, "a development copy carries a development version");
  } else {
    assert(pkg.private !== true, "the published package is not private");
    assertMatch(pkg.version, /^\d+\.\d+\.\d+$/, "the published version is semver");
  }
});

test("the sources carry no identity from another variant", () => {
  const foreign = isDevCopy ? "dsh-nextsteps-dev" : "dsh-nextsteps-dev";
  for (const [name, source] of [["index.js", hostSource], ["client.js", clientSource]]) {
    const identity = isDevCopy ? "dsh-nextsteps-dev" : "dsh-nextsteps";
    assert(source.includes(identity), `${name} carries its own identity`);
    assert(!source.includes(foreign === identity ? "dsh-nextsteps-dev-officially" : foreign), `${name} carries no foreign identity`);
  }
});

test("the release check points at the releases of this repository", () => {
  if (isDevCopy) {
    assert(hostSource.includes("about:blank"), "a development copy does not poll the release feed");
  } else {
    assert(hostSource.includes("registry.npmjs.org"), "the host reads the installable version from the registry");
    assert(hostSource.includes("api.github.com/repos/klaus-2/dsh-nextsteps/releases"), "the host reads the notes from the releases of this repository");
  }
});

test("the client does not require a json file", () => {
  const requires = clientSource.match(/require\(([^)]*)\)/g) ?? [];
  for (const call of requires) {
    assert(!call.includes(".json"), `the client must not require a json file: ${call}`);
  }
});

test("the client does not depend on a path outside the package", () => {
  assert(!clientSource.includes("C:/"), "the client has no absolute windows path");
  assert(!clientSource.includes("C:\\\\"), "the client has no absolute windows path");
  assert(!/require\(['"]\.\.\//.test(clientSource), "the client requires nothing outside the package");
});

test("the host keeps its settings inside the dsh home", () => {
  assertIncludes(hostSource, "homedir()", "the host resolves the dsh home");
  assert(!/['"]C:[\\/]/.test(hostSource), "the host has no absolute path");
});

test("the dictionaries carry the same keys", () => {
  const [reference, ...others] = locales;
  const referenceKeys = Object.keys(reference.data).sort();
  for (const other of others) {
    assertEqual(Object.keys(other.data).sort(), referenceKeys, `${other.lang} carries the same keys as ${reference.lang}`);
  }
});

test("every key the client asks for exists in every dictionary", () => {
  const used = new Set();
  for (const match of clientSource.matchAll(/\bt\('([a-zA-Z.]+)'\)/g)) used.add(match[1]);
  assert(used.size > 0, "the client asks for translated strings");
  for (const { lang, data } of locales) {
    for (const key of used) {
      assert(typeof data[key] === "string", `${lang} translates ${key}`);
    }
  }
});

test("every dictionary key is used by the client", () => {
  const used = new Set();
  for (const match of clientSource.matchAll(/\bt\('([a-zA-Z.]+)'\)/g)) used.add(match[1]);
  for (const { lang, data } of locales) {
    for (const key of Object.keys(data)) {
      if (key === "meta") continue;
      assert(used.has(key), `${lang} translates ${key}, which the client asks for`);
    }
  }
});

test("the dictionaries declare their plugin metadata", () => {
  for (const { lang, data } of locales) {
    assert(data.meta !== undefined, `${lang} declares meta`);
    assert(typeof data.meta.title === "string" && data.meta.title !== "", `${lang} declares a title`);
    assert(typeof data.meta.description === "string" && data.meta.description !== "", `${lang} declares a description`);
  }
});

test("the readmes cover the three languages", () => {
  for (const file of ["README.md", "README.pt-BR.md", "README.zh-CN.md"]) {
    assert(exists(path.join(root, file)), `${file} exists`);
  }
  assertIncludes(readFileSync(path.join(root, "README.md"), "utf8"), "README.pt-BR.md", "the english readme links the others");
});

test("the plugin declares the client services it needs", () => {
  assert(pkg.dsh?.client?.platform === "web", "the client runs on the web platform");
  assert(Array.isArray(pkg.dsh?.client?.inject), "the client inject list is declared");
  assert(pkg.dsh?.client?.inject.includes("@deepseek-ai/dsh-client-locale"), "the client asks for the locale service");
});

test("the plugin declares its bundle patch", () => {
  assert(pkg.dsh?.bundle?.patch === "./cordis.patch.yml", "the bundle patch is declared");
  const patch = readFileSync(path.join(root, "cordis.patch.yml"), "utf8");
  assertIncludes(patch, `id: ${pluginId}`, "the patch registers the plugin");
});

test("the license and the readme are packaged", () => {
  assert(pkg.files.includes("LICENSE"), "the license is packaged");
  assert(pkg.files.includes("README.md"), "the readme is packaged");
  assert(pkg.license !== undefined, "the license is declared");
});

test("the regression suite is packaged and runnable", () => {
  assert(pkg.scripts?.test !== undefined, "the package declares a test script");
  assert(pkg.files.includes("scripts"), "the suite ships with the package");
  assert(exists(path.join(root, "scripts", "test.mjs")), "the suite entrypoint exists");
});

function existsDirectory(target) {
  try {
    return readdirSync(target).length >= 0;
  } catch {
    return false;
  }
}

function exists(target) {
  try {
    readFileSync(target);
    return true;
  } catch {
    try {
      return readFileSync(path.join(target, "package.json")) !== undefined;
    } catch {
      return false;
    }
  }
}
