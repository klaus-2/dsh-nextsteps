import { readFileSync } from "node:fs";
import path from "node:path";
import { suite, test, assert, assertEqual, assertIncludes, pluginId } from "../harness.mjs";
import { root } from "../client-harness.mjs";

suite("contract: host and client agree");

const clientSource = readFileSync(path.join(root, "client.js"), "utf8");
const hostSource = readFileSync(path.join(root, "index.js"), "utf8");
const escaped = pluginId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const routePattern = new RegExp(`'/api/${escaped}\\.([a-z]+)'`, "g");

const CLIENT_ROUTES = [...clientSource.matchAll(routePattern)].map((match) => match[1]);
const HOST_ROUTES = [...hostSource.matchAll(routePattern)].map((match) => match[1]);

test("every route the client calls is registered by the host", () => {
  assert(CLIENT_ROUTES.length > 0, "the client calls host routes");
  for (const route of CLIENT_ROUTES) {
    assert(HOST_ROUTES.includes(route), `the host registers the ${route} route`);
  }
});

test("the host registers no route the client never calls", () => {
  for (const route of HOST_ROUTES) {
    assert(CLIENT_ROUTES.includes(route), `the client calls the ${route} route`);
  }
});

test("the settings the client sends are the ones the host reads", () => {
  const clientSends = [...clientSource.matchAll(/save\(\{ ([a-zA-Z]+):/g)].map((match) => match[1]);
  assert(clientSends.length > 0, "the client sends settings");
  for (const key of clientSends) {
    assert(hostSource.includes(`${key}:`), `the host reads the ${key} setting`);
  }
});

test("the settings the host stores are the ones the client renders", () => {
  const hostStores = [...hostSource.matchAll(/^\s{6}(lang|maxFollowups|showHeader|model):/gm)].map((match) => match[1]);
  for (const key of new Set(hostStores)) {
    assert(clientSource.includes(key), `the client renders the ${key} setting`);
  }
});

test("the plugin identity is the same on both halves", () => {
  assertIncludes(clientSource, `id: '${pluginId}',`, "the client registers the plugin id");
  assertIncludes(hostSource, `const name = '${pluginId}';`, "the host registers the plugin name");
  assertIncludes(hostSource, `const NPM_NAME = '${pluginId}';`, "the host watches the npm package");
});

test("the storage keys belong to the plugin", () => {
  const keys = [...clientSource.matchAll(/['"](dsh[.-][a-z0-9.-]+)['"]/g)].map((match) => match[1]);
  const owned = [...new Set(keys)].filter((key) => key.includes("suggest-followups") || key.includes("nextsteps"));
  assert(owned.length >= 2, "the client owns the clicked and the captures storage");
  for (const key of owned) {
    assert(key.includes(pluginId), `the storage key belongs to the plugin: ${key}`);
  }
});

test("the client tolerates any payload revision", () => {
  const hostRevision = hostSource.match(/PLUGIN_REV = '([a-z0-9-]+)'/)?.[1];
  assert(hostRevision !== undefined, "the host declares a payload revision");
  assert(clientSource.includes("rev"), "the client reads the payload revision");
  assert(!clientSource.includes(`rev: '${hostRevision}'`), "the client does not pin one revision");
});
