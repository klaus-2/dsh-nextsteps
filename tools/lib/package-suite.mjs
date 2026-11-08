import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { listPublishedReleases, readPublishedReleases } from "./release-suite.mjs";

export async function runPackageSuite(harness, { pluginDir, packageName }) {
  const manifest = JSON.parse(readFileSync(path.join(pluginDir, "package.json"), "utf8"));

  harness.section("package: identity");
  harness.eq("the package name matches", manifest.name, packageName);
  harness.check("the package is public", manifest.private !== true);
  harness.check("the package declares a version", /^\d+\.\d+\.\d+$/.test(manifest.version ?? ""), manifest.version);
  harness.check("the repository points at the public repo", typeof manifest.repository?.url === "string" && manifest.repository.url.includes(manifest.name), manifest.repository?.url);
  harness.check("the homepage points at the public repo", typeof manifest.homepage === "string" && manifest.homepage.startsWith("https://github.com/"));

  harness.section("package: entry points");
  for (const [key, target] of Object.entries(manifest.exports ?? {})) {
    if (target.includes("*")) {
      const directory = path.join(pluginDir, path.dirname(target));
      const pattern = new RegExp(`^${path.basename(target).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      const matches = existsSync(directory) ? readdirSync(directory).filter((entry) => pattern.test(entry)) : [];
      harness.check(`the export ${key} resolves to at least one file`, matches.length > 0, target);
      continue;
    }
    harness.check(`the export ${key} resolves`, existsSync(path.join(pluginDir, target)), target);
  }
  harness.check("the entrypoint is at the package root", existsSync(path.join(pluginDir, "index.js")));
  harness.check("the client entrypoint is at the package root", existsSync(path.join(pluginDir, "client.js")));
  harness.check("the cordis patch exists", existsSync(path.join(pluginDir, "cordis.patch.yml")));
  const patch = readFileSync(path.join(pluginDir, "cordis.patch.yml"), "utf8");
  harness.includes("the cordis patch names the plugin", patch, manifest.name);
  harness.eq("the plugin targets the web platform", manifest.dsh?.client?.platform, "web");

  harness.section("package: published files");
  for (const entry of manifest.files ?? []) {
    harness.check(`the published entry ${entry} exists`, existsSync(path.join(pluginDir, entry)), entry);
  }
  for (const readme of ["README.md", "README.pt-BR.md", "README.zh-CN.md"]) {
    if (!harness.check(`the ${readme} exists`, existsSync(path.join(pluginDir, readme)))) continue;
    harness.check(`the ${readme} is not a stub`, readFileSync(path.join(pluginDir, readme), "utf8").length > 500);
  }
  harness.check("the license exists", existsSync(path.join(pluginDir, "LICENSE")));
  harness.check("the icon exists", existsSync(path.join(pluginDir, "docs", "assets", "icon.png")));

  harness.section("package: locale files");
  {
    const codes = ["en", "pt-BR", "zh-CN"];
    const dictionaries = [];
    for (const code of codes) {
      const file = path.join(pluginDir, "lib", "locale", `${code}.json`);
      if (!harness.check(`the ${code} locale file exists`, existsSync(file))) continue;
      const data = JSON.parse(readFileSync(file, "utf8"));
      dictionaries.push([code, data]);
      harness.check(`the ${code} locale file has a title`, typeof data.meta?.title === "string" && data.meta.title !== "");
      harness.check(`the ${code} locale file has a description`, typeof data.meta?.description === "string" && data.meta.description !== "");
    }
    if (dictionaries.length === codes.length) {
      const reference = Object.keys(dictionaries[0][1]).filter((key) => key !== "meta").sort();
      for (const [code, data] of dictionaries) {
        harness.eq(`the ${code} locale file has the same keys`, Object.keys(data).filter((key) => key !== "meta").sort(), reference);
      }
    }
  }

  harness.section("package: release invariants");
  harness.check("the test script is wired", typeof manifest.scripts?.test === "string" && manifest.scripts.test !== "");
  harness.check("no npmrc is committed", !existsSync(path.join(pluginDir, ".npmrc")));

  harness.section("package: published releases");
  const repo = String(manifest.repository?.url ?? "")
    .replace(/^git\+/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace("github.com/", "");
  const releases = await listPublishedReleases(repo, 20);
  if (releases === undefined) {
    harness.skip("every published release title follows the convention", "the gh CLI or the network is unavailable");
    harness.skip("no published release body describes another version", "the gh CLI or the network is unavailable");
  } else {
    const wrong = releases.filter((release) => release.name !== `${manifest.name} ${release.tagName}`);
    harness.check("every published release title follows the convention", wrong.length === 0, wrong.map((release) => release.name).join(", "));
    const published = await readPublishedReleases(repo, releases.map((release) => release.tagName));
    harness.eq("every published release body could be read", published.length, releases.length);
    const escapedName = manifest.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stale = published.filter((release) => {
      const version = release.tagName.replace(/^v/, "");
      const body = release.body ?? "";
      const heading = /^#+\s+(?:[A-Za-z0-9_-]+\s+)?v?(\d+\.\d+\.\d+)/m.exec(body);
      const packageRef = new RegExp(`${escapedName}@(\\d+\\.\\d+\\.\\d+)`).exec(body);
      const mentioned = [heading?.[1], packageRef?.[1]].filter((value) => value !== undefined);
      return mentioned.some((other) => other !== version);
    });
    harness.check("no published release body describes another version", stale.length === 0, stale.map((release) => release.tagName).join(", "));
  }

  harness.section("package: secrets");
  for (const relative of ["index.js", "client.js", "package.json"]) {
    const file = path.join(pluginDir, relative);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const leaked = /npm_[A-Za-z0-9]{20,}|_authToken\s*=|NPM_TOKEN\s*=\s*["'][^"']+/.test(text);
    harness.check(`${relative} carries no token`, !leaked);
  }
}
