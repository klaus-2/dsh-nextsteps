// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { suite, test, assert, assertEqual, assertIncludes, pluginId } from "../harness.mjs";
import { root } from "../client-harness.mjs";

const GOLDEN_RELATIVE = "scripts/suite/fixtures/golden.json";
const goldenPath = path.join(root, GOLDEN_RELATIVE);
const CAPTURE = process.env.DSH_REPLAY_CAPTURE === "1";
const originalAbortTimeout = AbortSignal.timeout;

const KEYS = [
  "probe",
  "regen",
  "normal",
  "fixture-valid",
  "400-bad-request",
  "400-fixture-invalid",
  "409-moved-on",
  "cancelled",
  "timedOut",
  "502-provider",
  "400-empty-transcript",
  "fallback-model"
];
const CASE_FIELDS = ["status", "body", "source", "model", "rev"];
const NULLABLE_FIELDS = ["source", "model", "rev"];

const captured = {};
if (CAPTURE) {
  process.on("exit", () => {
    if (process.env.DSH_REPLAY_CAPTURE !== "1") return;
    if (Object.keys(captured).length !== KEYS.length) return;
    const ordered = {};
    for (const key of KEYS) ordered[key] = captured[key];
    writeFileSync(goldenPath, `${JSON.stringify(ordered, null, 2)}\n`);
  });
}

function assertCaseSchema(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label}: case is an object`);
  assertEqual(Object.keys(value).sort(), [...CASE_FIELDS].sort(), `${label}: exactly status/body/source/model/rev`);
  assert(Number.isSafeInteger(value.status), `${label}: status is a safe integer`);
  assert(value.body !== null && typeof value.body === "object" && !Array.isArray(value.body), `${label}: body is an object`);
  for (const field of NULLABLE_FIELDS) {
    assert(value[field] === null || typeof value[field] === "string", `${label}: ${field} is a string or null`);
  }
}

function loadGolden() {
  let text;
  try {
    text = readFileSync(goldenPath, "utf8");
  } catch (error) {
    throw new Error(`golden.json is missing at ${goldenPath}; run with DSH_REPLAY_CAPTURE=1 (${error.message})`);
  }
  let golden;
  try {
    golden = JSON.parse(text);
  } catch (error) {
    throw new Error(`golden.json is not valid JSON at ${goldenPath} (${error.message})`);
  }
  assert(golden !== null && typeof golden === "object" && !Array.isArray(golden), "golden is an object");
  assertEqual(Object.keys(golden).sort(), [...KEYS].sort(), "golden has exactly the 12 canonical keys");
  for (const key of KEYS) assertCaseSchema(golden[key], `golden.${key}`);
  return golden;
}

function assertMatchesGolden(key, result, expected) {
  assertCaseSchema(expected, `golden.${key}`);
  for (const field of CASE_FIELDS) {
    assertEqual(result[field], expected[field], `${key}: ${field}`);
  }
}

const moduleUrl = new URL(`../../index.js?replay=${Date.now()}`, import.meta.url);
const mod = await import(moduleUrl.href);

const conversationEvents = [
  { seq: 1, type: "user/message", data: { content: [{ type: "text", text: "please fix the parser" }], source: { kind: "user" } } },
  { seq: 2, type: "assistant/message", data: { message: { content: [{ type: "text", text: "done" }] } } },
  { seq: 9, type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } }
];
const movedOnEvents = [
  { seq: 1, type: "user/message", data: { content: [{ type: "text", text: "please fix the parser" }], source: { kind: "user" } } },
  { seq: 9, type: "turn/end", data: { turn: 1, reason: { kind: "cancelled" } } }
];
const emptyEvents = [
  { seq: 9, type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } }
];
const MODEL_TEXT = '{"followups":[{"prompt":"Run the parser tests","label":"Tests"},{"prompt":"Review the diff","label":"Review"}]}';

const SESSION_ID = "s1";
const AFTER_SEQ = 9;

function requestBody(kind, overrides = {}) {
  const base = { sessionId: SESSION_ID, afterSeq: AFTER_SEQ };
  if (kind === "probe") return { ...base, validate: true };
  if (kind === "generate") return { ...base, ...overrides };
  throw new Error(`unknown request body kind: ${kind}`);
}

function textStream(text) {
  return async function* () {
    yield { type: "text-delta", text };
    yield { type: "finish", reason: { kind: "stop" } };
  };
}

function errorStream(message) {
  return async function* () {
    yield { type: "finish", reason: { kind: "error", failure: { message } } };
  };
}

function makeLlm(stream, { streamsByModel = {}, models = [] } = {}) {
  const calls = [];
  const llm = {
    listProviders: () => [{ id: "demo", name: "Demo" }],
    listModels: async () => [{ id: "demo-model", name: "Demo Model" }, ...models],
    prepareCall: async (route) => {
      calls.push(route);
      return { config: { provider: route.provider, model: route.model }, stream: streamsByModel[route.model] ?? stream };
    }
  };
  return { llm, calls };
}

async function mount({ events = conversationEvents, llm, disposed, settings = {} } = {}) {
  const routes = new Map();
  const ctx = {
    tools: { register: () => () => {}, unregister: () => {} },
    connection: { fetch: { register: (route) => routes.set(route.path, route) } },
    get: (name) => {
      if (name === "sessionQuery") return { observeSession: async () => ({ events, [Symbol.dispose]: () => { if (disposed !== undefined) disposed.count += 1; } }) };
      if (name === "llm") return llm;
      if (name === "agentDefaultModel") return { currentSelection: () => ({ provider: "demo", model: "demo-model" }) };
      if (name === "systemPrompt") return { section: () => {} };
      return undefined;
    }
  };
  await mod.apply(ctx);
  await routes.get(`/api/${pluginId}.settings`).fetch(new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lang: "auto", model: "", maxFollowups: 3, maxSuggestionChars: 200, latencyBudgetMs: 60000, generationMode: "auto", transcriptScope: "full", ...settings })
  }));
  const generateRoute = routes.get(`/api/${pluginId}.generate`);
  const generate = (body, signal) => generateRoute.fetch(new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(signal === undefined ? {} : { signal })
  }));
  return { generate };
}

async function withFixture(value, run) {
  const previous = process.env.DSH_NEXTSTEPS_FIXTURE;
  try {
    if (value === undefined) delete process.env.DSH_NEXTSTEPS_FIXTURE;
    else process.env.DSH_NEXTSTEPS_FIXTURE = value;
    return await run();
  } finally {
    if (previous === undefined) delete process.env.DSH_NEXTSTEPS_FIXTURE;
    else process.env.DSH_NEXTSTEPS_FIXTURE = previous;
  }
}

async function fromResponse(response) {
  const body = await response.json();
  return {
    status: response.status,
    body,
    source: body.source ?? null,
    model: body.model ?? null,
    rev: body.rev ?? null
  };
}

function finish(key, result, assertExpected) {
  assertExpected(result);
  assertCaseSchema(result, `result.${key}`);
  if (CAPTURE) {
    captured[key] = result;
    return;
  }
  const golden = loadGolden();
  assert(golden[key] !== undefined, `golden has the ${key} case`);
  assertMatchesGolden(key, result, golden[key]);
}

function oneByteVariant(value) {
  if (typeof value === "string" && value.length > 0) {
    const last = value.charCodeAt(value.length - 1);
    return value.slice(0, -1) + String.fromCharCode(last === 122 ? 97 : last + 1);
  }
  if (Number.isSafeInteger(value)) return value + 1;
  throw new Error(`no one-byte variant for ${typeof value}`);
}

function oneByteBodyVariant(body) {
  const clone = JSON.parse(JSON.stringify(body));
  const mutateFirstString = (node) => {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === "string" && value.length > 0) {
        node[key] = oneByteVariant(value);
        return true;
      }
      if (value !== null && typeof value === "object" && mutateFirstString(value)) return true;
    }
    return false;
  };
  assert(mutateFirstString(clone), "the golden body has a string leaf to mutate");
  return clone;
}

function expectComparisonFailure(key, result, candidate, field) {
  let message;
  try {
    assertMatchesGolden(key, result, candidate);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(message !== undefined, `a one-byte ${field} mutation fails the comparison`);
  assert(message.includes(`${key}: ${field}`), `the failure identifies ${field}: ${message}`);
}

suite("replay: golden capture of the generate contract");

test("probe captures a completed-turn validation", async () => {
  const { generate } = await mount();
  const result = await fromResponse(await generate(requestBody("probe")));
  finish("probe", result, (value) => {
    assertEqual(value.status, 200, "probe status");
    assertEqual(value.body, { ok: true, completed: true }, "probe body");
    assert(value.source === null && value.model === null && value.rev === null, "probe carries no source, model or rev");
  });
});

test("both gate variants dispose their session observation exactly once", async () => {
  const disposed = { count: 0 };
  const { llm } = makeLlm(textStream(MODEL_TEXT));
  const { generate } = await mount({ llm, disposed });
  await generate(requestBody("probe"));
  await generate(requestBody("generate"));
  assertEqual(disposed.count, 2, "probe and generation each release one observation");
});

test("regen captures an avoid-driven generation trimmed to one card", async () => {
  const { llm } = makeLlm(textStream(MODEL_TEXT));
  const { generate } = await mount({ llm });
  const result = await fromResponse(await generate(requestBody("generate", { maxFollowups: 1, avoid: ["please fix the parser"] })));
  finish("regen", result, (value) => {
    assertEqual(value.status, 200, "regen status");
    assertEqual(value.body.ok, true, "regen ok");
    assertEqual(value.rev, "sf-3", "regen rev");
    assertEqual(value.source, "transcript", "regen source");
    assertEqual(value.model, "demo-model", "regen model");
    assertEqual(value.body.followups.length, 1, "regen is trimmed to one card");
  });
});

test("normal captures an override-driven generation", async () => {
  const { llm } = makeLlm(textStream(MODEL_TEXT));
  const { generate } = await mount({ llm });
  const result = await fromResponse(await generate(requestBody("generate", { lang: "en" })));
  finish("normal", result, (value) => {
    assertEqual(value.status, 200, "normal status");
    assertEqual(value.body.ok, true, "normal ok");
    assertEqual(value.rev, "sf-3", "normal rev");
    assertEqual(value.source, "transcript", "normal source");
    assertEqual(value.model, "demo-model", "normal model");
    assertEqual(value.body.followups.length, 2, "normal carries both cards");
  });
});

test("fixture-valid captures the deterministic fixture seam", async () => {
  await withFixture('[{"prompt":"Fixo","label":"Fixo"},{"prompt":"Segundo"}]', async () => {
    const { llm, calls } = makeLlm(textStream(MODEL_TEXT));
    const { generate } = await mount({ llm });
    const result = await fromResponse(await generate(requestBody("generate")));
    assertEqual(calls.length, 0, "the fixture path never calls the llm");
    finish("fixture-valid", result, (value) => {
      assertEqual(value.status, 200, "fixture status");
      assertEqual(value.source, "fixture", "fixture source");
      assertEqual(value.model, "fixture", "fixture model");
      assertEqual(value.rev, "sf-3", "fixture rev");
      assertEqual(value.body.followups, [{ prompt: "Fixo", label: "Fixo" }, { prompt: "Segundo", label: null }], "fixture cards");
    });
  });
});

test("400-bad-request captures the malformed body refusal", async () => {
  const { generate } = await mount();
  const result = await fromResponse(await generate("not json"));
  finish("400-bad-request", result, (value) => {
    assertEqual(value.status, 400, "bad request status");
    assertEqual(value.body, { error: "bad request" }, "bad request body");
    assert(value.source === null && value.model === null && value.rev === null, "bad request has no source, model or rev");
  });
});

test("400-fixture-invalid captures the unusable fixture refusal", async () => {
  await withFixture("not json", async () => {
    const { generate } = await mount();
    const result = await fromResponse(await generate(requestBody("generate")));
    finish("400-fixture-invalid", result, (value) => {
      assertEqual(value.status, 400, "invalid fixture status");
      assertEqual(value.body, { error: "the DSH_NEXTSTEPS_FIXTURE value is not usable followups JSON" }, "invalid fixture body");
    });
  });
});

test("409-moved-on captures the not-completed turn refusal", async () => {
  const { generate } = await mount({ events: movedOnEvents });
  const result = await fromResponse(await generate(requestBody("generate")));
  finish("409-moved-on", result, (value) => {
    assertEqual(value.status, 409, "moved-on status");
    assertEqual(value.body, { error: "the chat moved on" }, "moved-on body");
  });
});

test("cancelled captures an aborted request", async () => {
  const controller = new AbortController();
  const abortStream = async function* () {
    controller.abort();
    yield { type: "finish", reason: { kind: "aborted" } };
  };
  const { llm, calls } = makeLlm(abortStream);
  const { generate } = await mount({ llm });
  const result = await fromResponse(await generate(requestBody("generate"), controller.signal));
  assert(calls.length >= 1, "the cancelled case reached the model");
  finish("cancelled", result, (value) => {
    assertEqual(value.status, 502, "cancelled status");
    assertIncludes(value.body.error, "cancelled", "cancelled error");
    assert(value.body.timedOut !== true, "cancellation is not a timeout");
  });
});

test("timedOut captures a generation deadline expiry", async () => {
  const waitingStream = async function* (request) {
    if (request.signal.aborted === false) {
      await new Promise((resolve) => request.signal.addEventListener("abort", resolve, { once: true }));
    }
    yield { type: "finish", reason: { kind: "aborted" } };
  };
  const { llm, calls } = makeLlm(waitingStream);
  const { generate } = await mount({ llm });
  let result;
  try {
    globalThis.AbortSignal.timeout = () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 200);
      return controller.signal;
    };
    result = await fromResponse(await generate(requestBody("generate")));
  } finally {
    globalThis.AbortSignal.timeout = originalAbortTimeout;
  }
  assert(AbortSignal.timeout === originalAbortTimeout, "AbortSignal.timeout restored after the timeout case");
  assert(calls.length >= 1, "the timeout case reached the model");
  finish("timedOut", result, (value) => {
    assertEqual(value.status, 502, "timeout status");
    assertIncludes(value.body.error, "timed out", "timeout error");
    assertEqual(value.body.timedOut, true, "timeout flag");
  });
});

test("a stalled model catalog times out with the timedOut flag", async () => {
  const llm = {
    listProviders: () => [{ id: "demo", name: "Demo" }],
    listModels: () => new Promise(() => {}),
    prepareCall: async () => { throw new Error("the model call was unreachable"); }
  };
  const { generate } = await mount({ llm });
  let result;
  try {
    globalThis.AbortSignal.timeout = () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 200);
      return controller.signal;
    };
    result = await fromResponse(await generate(requestBody("generate")));
  } finally {
    globalThis.AbortSignal.timeout = originalAbortTimeout;
  }
  assertEqual(result.status, 502, "a stalled route catalog ends as a provider failure");
  assertEqual(result.body.error, "the generation timed out", "the timeout message stays byte-identical");
  assertEqual(result.body.timedOut, true, "the deadline keeps the timedOut flag on the wire");
});

test("cancelling a stalled model catalog reports cancellation, not a timeout", async () => {
  const llm = {
    listProviders: () => [{ id: "demo", name: "Demo" }],
    listModels: () => new Promise(() => {}),
    prepareCall: async () => { throw new Error("the model call was unreachable"); }
  };
  const { generate } = await mount({ llm });
  const controller = new AbortController();
  const pending = generate(requestBody("generate"), controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  const result = await fromResponse(await pending);
  assertEqual(result.status, 502, "cancellation keeps the existing status");
  assertEqual(result.body.error, "the generation was cancelled", "the cancellation message is preserved");
  assert(result.body.timedOut !== true, "a cancellation is never flagged as a timeout");
});

test("502-provider captures a generic model failure", async () => {
  const { llm, calls } = makeLlm(errorStream("upstream exploded"));
  const { generate } = await mount({ llm });
  const result = await fromResponse(await generate(requestBody("generate")));
  assertEqual(calls.length, 3, "all three attempts ran before the failure");
  finish("502-provider", result, (value) => {
    assertEqual(value.status, 502, "provider failure status");
    assertIncludes(value.body.error, "upstream exploded", "provider failure detail");
    assert(value.body.timedOut !== true, "provider failure is not a timeout");
  });
});

test("400-empty-transcript captures a completed turn without content", async () => {
  const { generate } = await mount({ events: emptyEvents });
  const result = await fromResponse(await generate(requestBody("generate")));
  finish("400-empty-transcript", result, (value) => {
    assertEqual(value.status, 400, "empty transcript status");
    assertEqual(value.body, { error: "this turn has no conversation content to suggest from" }, "empty transcript body");
  });
});

test("fallback-model captures a reserve round on the chat default model", async () => {
  const { llm, calls } = makeLlm(textStream(MODEL_TEXT), {
    models: [{ id: "deepseek", name: "DeepSeek" }],
    streamsByModel: { deepseek: errorStream("reserve exploded") }
  });
  const { generate } = await mount({ llm, settings: { fallbackModel: true, model: "demo/deepseek" } });
  const result = await fromResponse(await generate(requestBody("generate")));
  assertEqual(calls.filter((route) => route.model === "deepseek").length, 3, "the chosen model spends its three attempts");
  assertEqual(calls.filter((route) => route.model === "demo-model").length, 1, "the reserve answers once on the default route");
  finish("fallback-model", result, (value) => {
    assertEqual(value.status, 200, "fallback status");
    assertEqual(value.body.ok, true, "fallback ok");
    assertEqual(value.rev, "sf-3", "fallback rev");
    assertEqual(value.source, "fallback", "the fallback overrides the transcript source");
    assertEqual(value.model, "demo-model", "the answer names the chat default model");
    assertEqual(value.body.followups.length, 2, "the reserve carries both cards");
  });
});

test("the body builder emits exactly the two pinned request forms", async () => {
  const probe = requestBody("probe");
  const generate = requestBody("generate");
  assertEqual(probe, { sessionId: "s1", afterSeq: 9, validate: true }, "probe form carries validate:true");
  assertEqual(generate, { sessionId: "s1", afterSeq: 9 }, "generate form carries only sessionId/afterSeq");
  assert(probe.avoid === undefined, "probe form has no avoid key");
  assert(generate.avoid === undefined, "generate form has no avoid key without captures (client.test.mjs:4814)");
  assertEqual(requestBody("generate", { lang: "en" }), { sessionId: "s1", afterSeq: 9, lang: "en" }, "generate overrides are explicit");
});

test("a one-byte mutation in any compared field fails the golden comparison", async () => {
  if (CAPTURE) return;
  const golden = loadGolden();
  const key = "normal";
  const original = golden[key];
  assertMatchesGolden(key, original, original);
  for (const field of CASE_FIELDS) {
    assert(original[field] !== null, `${key}.${field} is non-null and admits a one-byte variant`);
    const mutated = field === "body" ? oneByteBodyVariant(original.body) : oneByteVariant(original[field]);
    assert(JSON.stringify(mutated) !== JSON.stringify(original[field]), `the ${field} mutation changed the value`);
    expectComparisonFailure(key, original, { ...original, [field]: mutated }, field);
  }
});
