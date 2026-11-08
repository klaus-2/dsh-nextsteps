import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function mapLimit(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function readPublishedRelease(repo, tag) {
  try {
    const { stdout } = await run("gh", ["release", "view", tag, "--repo", repo, "--json", "name,body,tagName"], { timeout: 20000, windowsHide: true });
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

export async function readPublishedReleases(repo, tags) {
  const releases = await mapLimit(tags, 4, (tag) => readPublishedRelease(repo, tag));
  return releases.filter((release) => release !== undefined);
}

export async function listPublishedReleases(repo, limit = 20) {
  try {
    const { stdout } = await run("gh", ["release", "list", "--repo", repo, "--limit", String(limit), "--json", "name,tagName"], { timeout: 20000, windowsHide: true });
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}
