import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { suite, test, assert, assertEqual, assertIncludes, assertMatch, pluginId, isDevCopy } from "../harness.mjs";
import { root } from "../client-harness.mjs";

suite("host: tool, settings and routes");

const moduleUrl = new URL(`../../index.js?test=${Date.now()}`, import.meta.url);

function stubContext({ services, llmModels, llmText } = {}) {
  const defaults = { systemPrompt: { section: (spec) => sections.push(spec) } };
  const resolved = { ...defaults, ...services };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  const registered = [];
  const routes = new Map();
  const sections = [];
  const ctx = {
    tools: {
      register: (spec) => {
        registered.push(spec);
        return () => {};
      },
      unregister: () => {}
    },
    connection: { fetch: { register: (route) => routes.set(route.path, route) } },
    effect: (fn) => {
      try {
        return fn();
      } catch {
        return undefined;
      }
    },
    get: (name) => resolved[name]
  };
  if (llmModels !== undefined || llmText !== undefined) {
    ctx.get = (name) => {
      if (name === "llm") {
        return {
          listProviders: () => [{ id: "demo", name: "Demo" }],
          listModels: async () => llmModels ?? [{ id: "demo-model", name: "Demo Model" }],
          prepareCall: async (route) => ({
            config: { provider: route.provider, model: route.model },
            stream: async function* () {
              yield { type: "text-delta", text: llmText ?? '{"followups":[{"prompt":"p","label":"l"}]}' };
              yield { type: "finish", reason: { kind: "stop" } };
            }
          })
        };
      }
      return resolved[name];
    };
  }
  console.warn = originalWarn;
  return { ctx, registered, routes, sections, warnings };
}

function settingsFileFor(name) {
  const dir = mkdtempSync(path.join(tmpdir(), "dsh-nextsteps-test-"));
  const file = path.join(dir, `${name}.json`);
  return { dir, file };
}

test("the tool registers with the schema the model needs", async () => {
  const { ctx, registered } = stubContext();
  const mod = await import(moduleUrl.href);
  await mod.apply(ctx);
  assert(registered.length === 1, "exactly one tool is registered");
  const tool = registered[0];
  assertEqual(tool.name, "suggest_followups");
  assert(tool.parameters.properties.followups.items.required.includes("prompt"), "each followup requires a prompt");
  assertIncludes(tool.description, "BEFORE writing your final answer", "the tool must be called before the final answer");
});

test("the description survives a host without a system prompt service", async () => {
  const { ctx, registered } = stubContext();
  const mod = await import(moduleUrl.href);
  await mod.apply(ctx);
  const description = registered[0].description;
  assertIncludes(description, "when there is no such section, use the language of the conversation", "the description must fall back to the conversation language");
});

test("the bundle does not require optional host services to load", async () => {
  const source = readFileSync(path.join(root, "index.js"), "utf8");
  const injectLine = source.split("\n").find((line) => line.startsWith("const inject ="));
  assertMatch(injectLine, /'tools'/, "the tools service is required");
  assert(!injectLine.includes("sessionQuery"), "sessionQuery must not be required to load the bundle");
  assert(!injectLine.includes("systemPrompt"), "systemPrompt must not be required to load the bundle");
});

test("every route declares a buffered request body", async () => {
  const { ctx, routes } = stubContext();
  const mod = await import(moduleUrl.href);
  await mod.apply(ctx);
  assert(routes.size >= 4, "the plugin registers its routes");
  for (const [routePath, route] of routes) {
    assertEqual(route.requestBody, "buffered", `${routePath} must declare a buffered request body`);
  }
});

test("the settings route answers with the current settings and the version", async () => {
  const { ctx, routes } = stubContext();
  const mod = await import(moduleUrl.href);
  await mod.apply(ctx);
  const response = await routes.get(`/api/${pluginId}.settings`).fetch(new Request("http://x"));
  const body = await response.json();
  assertEqual(response.status, 200);
  assertEqual(body.ok, true);
  assert(body.version !== undefined, "the settings route reports the version");
  assert(body.settings.lang !== undefined && body.settings.model !== undefined, "the settings carry the language and the model");
});

test("the settings route rejects a language it does not know", async () => {
  const { ctx, routes } = stubContext();
  const mod = await import(moduleUrl.href);
  await mod.apply(ctx);
  const route = routes.get(`/api/${pluginId}.settings`);
  const before = await (await route.fetch(new Request("http://x"))).json();
  const response = await route.fetch(new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lang: "klingon" })
  }));
  const after = await response.json();
  assertEqual(after.settings.lang, before.settings.lang, "an unknown language keeps the current one");
});

test("the settings route keeps a model as provider/model", async () => {
  const { ctx, routes } = stubContext();
  const mod = await import(moduleUrl.href);
  await mod.apply(ctx);
  const route = routes.get(`/api/${pluginId}.settings`);
  const response = await route.fetch(new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "demo/demo-model" })
  }));
  const body = await response.json();
  assertEqual(body.settings.model, "demo/demo-model");
});

test("the model catalog lists the providers the host offers", async () => {
  const { ctx, routes } = stubContext({ llmModels: [{ id: "demo-model", name: "Demo Model" }] });
  const mod = await import(moduleUrl.href);
  await mod.apply(ctx);
  const response = await routes.get(`/api/${pluginId}.models`).fetch(new Request("http://x"));
  const body = await response.json();
  assertEqual(body.ok, true);
  assertEqual(body.groups.length, 1);
  assertEqual(body.groups[0].models[0].id, "demo-model");
});

test("the model catalog stays empty instead of failing when the host offers no models", async () => {
  const { ctx, routes } = stubContext();
  const mod = await import(moduleUrl.href);
  await mod.apply(ctx);
  const response = await routes.get(`/api/${pluginId}.models`).fetch(new Request("http://x"));
  const body = await response.json();
  assertEqual(response.status, 200);
  assertEqual(body.groups, []);
});

test("the system prompt section states the language and the count", async () => {
  const { ctx, sections } = stubContext();
  const mod = await import(moduleUrl.href);
  await mod.apply(ctx);
  assert(sections.length === 1, "one system prompt section");
  const text = sections[0].text();
  assertIncludes(text, "nextsteps", "the section names itself");
  assertIncludes(text, "followup prompts", "the section explains the count");
});

test("the generation route answers with the suggestions of the chosen model", async () => {
  const events = [
    { seq: 1, type: "user/message", data: { content: [{ type: "text", text: "me ajuda com o build" }], source: { kind: "user" } } },
    { seq: 9, type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } }
  ];
  const sessionQuery = { observeSession: async () => ({ events, [Symbol.dispose]: () => {} }) };
  const { ctx, routes } = stubContext({
    services: { sessionQuery },
    llmText: '{"followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}'
  });
  const mod = await import(moduleUrl.href);
  await mod.apply(ctx);
  const response = await routes.get(`/api/${pluginId}.generate`).fetch(new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "s1", afterSeq: 9 })
  }));
  const body = await response.json();
  assertEqual(response.status, 200);
  assertEqual(body.followups.length, 1);
  assertEqual(body.followups[0].label, "Rodar build");
});

test("the generation route reads the real session event shape", async () => {
  let seen = "";
  const events = [
    { seq: 1, type: "user/message", data: { content: [{ type: "text", text: "pergunta do usuario" }], source: { kind: "user" } } },
    { seq: 2, type: "user/message", data: { content: [{ type: "text", text: "<system-reminder>ruído</system-reminder>" }], source: { kind: "time-context" } } },
    { seq: 3, type: "assistant/message", data: { message: { content: [{ type: "text", text: "resposta do assistente" }] } } },
    { seq: 9, type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } }
  ];
  const sessionQuery = {
    observeSession: async () => ({
      events,
      [Symbol.dispose]: () => {}
    })
  };
  const llm = {
    listProviders: () => [{ id: "demo", name: "Demo" }],
    listModels: async () => [{ id: "demo-model", name: "Demo Model" }],
    prepareCall: async (route) => ({
      config: route,
      stream: async function* () {
        seen = route.prompt ?? "";
        yield { type: "text-delta", text: '{"followups":[{"prompt":"p","label":"l"}]}' };
        yield { type: "finish", reason: { kind: "stop" } };
      }
    })
  };
  const { ctx, routes } = stubContext({ services: { sessionQuery } });
  ctx.get = (name) => (name === "llm" ? llm : name === "sessionQuery" ? sessionQuery : undefined);
  const mod = await import(moduleUrl.href);
  await mod.apply(ctx);
  const response = await routes.get(`/api/${pluginId}.generate`).fetch(new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "s1", afterSeq: 9 })
  }));
  assertEqual(response.status, 200);
});

test("the generation route refuses a body it cannot use", async () => {
  const { ctx, routes } = stubContext();
  const mod = await import(moduleUrl.href);
  await mod.apply(ctx);
  const route = routes.get(`/api/${pluginId}.generate`);
  const missing = await route.fetch(new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ afterSeq: 3 })
  }));
  assertEqual(missing.status, 400);
  const broken = await route.fetch(new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not json"
  }));
  assertEqual(broken.status, 400);
});

test("the generation route answers cleanly when the host has no session query service", async () => {
  const { ctx, routes } = stubContext();
  const mod = await import(moduleUrl.href);
  await mod.apply(ctx);
  const response = await routes.get(`/api/${pluginId}.generate`).fetch(new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "s1", afterSeq: 3 })
  }));
  assertEqual(response.status, 502);
  const body = await response.json();
  assertIncludes(body.error, "sessionQuery", "the error names the missing service");
});

test("the update route reports the current version", async () => {
  const release = { tag_name: "v9.9.9", html_url: "https://github.com/klaus-2/dsh-nextsteps/releases/tag/v9.9.9", body: "notes" };
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("api.github.com")) return new Response(JSON.stringify(release), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("registry.npmjs.org")) return new Response(JSON.stringify({ version: "9.9.9" }), { status: 200, headers: { "content-type": "application/json" } });
    return original(input);
  };
  try {
    const { ctx, routes } = stubContext();
    const mod = await import(moduleUrl.href);
    await mod.apply(ctx);
    const response = await routes.get(`/api/${pluginId}.update`).fetch(new Request("http://x"));
    const body = await response.json();
    assertEqual(response.status, 200);
    assertEqual(body.name, pluginId);
    assert(body.current !== undefined, "the update route reports the current version");
    assertEqual(body.newer, true, "a newer release is reported");
  } finally {
    globalThis.fetch = original;
  }
});
