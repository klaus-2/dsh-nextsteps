import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "./harness.mjs";

const home = mkdtempSync(path.join(tmpdir(), "dsh-nextsteps-home-"));
const previousProfile = process.env.USERPROFILE;
const previousHome = process.env.HOME;
process.env.USERPROFILE = home;
process.env.HOME = home;
let code;
try {
  code = await run();
} finally {
  if (previousProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousProfile;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
}
process.exit(code);
