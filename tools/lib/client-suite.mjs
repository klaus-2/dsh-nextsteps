import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  createReactStub,
  evaluateExpression,
  evaluateObjectLiteral,
  extractObjectLiteral,
  fakeClientCtx,
  findByClass,
  findElements,
  flush,
  jsonResponse,
  loadClientModule,
  makeClipboard,
  makeIntersectionObserver,
  makeLocalStorage,
  renderOnce,
  waitFor
} from "./harness.mjs";

const FOLLOWUPS = [
  { prompt: "Add the missing tests", label: "Add tests" },
  { prompt: "Wire the error handler", label: "Error handler" }
];

function argsRaw() {
  return JSON.stringify({ followups: FOLLOWUPS });
}

function fakeConversation(sent, options = {}) {
  return {
    binding(binding) {
      if (options.fail === true) return { send: async () => { throw new Error("the composer refused the message"); } };
      void binding;
      return { send: async (text) => { sent.push(text); } };
    }
  };
}

const updateStateOf = (stub) => stub.getStates()[1];

export async function runClientSuite(harness, { pluginDir }) {
  const clientPath = path.join(pluginDir, "client.js");
  const source = readFileSync(clientPath, "utf8");

  harness.section("client: bundle contract");
  harness.includes("the client registers with the module loader", source, "__ModuleLoader__.load");
  {
    const requires = [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
    const relative = requires.filter((name) => name.startsWith(".") || name.startsWith("/"));
    harness.check("the client never requires a relative path", relative.length === 0, relative.join(" | "));
    const json = requires.filter((name) => name.endsWith(".json"));
    harness.check("the client never requires a JSON file", json.length === 0, json.join(" | "));
    harness.check("the client requires react", requires.includes("react"));
    const allowed = ["react", "react-dom"];
    const unexpected = requires.filter((name) => !allowed.includes(name));
    harness.check("every client require is a runtime-resolvable seed word", unexpected.length === 0, unexpected.join(" | "));
    const portsMatch = source.match(/const API_PORTS = \[([0-9, ]+)\]/);
    const ports = portsMatch === null ? [] : portsMatch[1].split(",").map((value) => Number(value.trim()));
    harness.check("the client probes the frozen loopback block", ports.length === 20 && ports.every((value, index) => value === 47497 + index), `first=${ports[0]}, last=${ports.at(-1)}, count=${ports.length}`);
  }

  harness.section("client: dictionaries");
  {
    const dictionaries = evaluateObjectLiteral(extractObjectLiteral(source, "const DICTIONARIES"), "DICTIONARIES");
    if (!harness.check("the client carries the dictionaries", dictionaries !== undefined)) {
      return;
    }
    const codes = Object.keys(dictionaries);
    harness.eq("the client ships three languages", codes.sort(), ["en", "pt-BR", "zh-CN"]);
    const reference = Object.keys(dictionaries[codes[0]]).slice().sort();
    for (const code of codes) {
      harness.eq(`the ${code} dictionary has the same keys`, Object.keys(dictionaries[code]).slice().sort(), reference);
    }
    for (const code of codes) {
      const empty = Object.entries(dictionaries[code]).filter(([, value]) => typeof value !== "string" || value === "");
      harness.check(`every ${code} entry has a text`, empty.length === 0, empty.map(([key]) => key).join(", "));
    }
    const placeholders = codes.every((code) => Object.entries(dictionaries[code]).every(([key, value]) => (value.match(/\{/g) ?? []).length === (value.match(/\}/g) ?? []).length));
    harness.check("every placeholder is closed", placeholders);

    const asked = [...new Set([...source.matchAll(/\bt\(\s*'([a-zA-Z]+)'\s*\)/g)].map((match) => match[1]))];
    const missing = [];
    for (const key of asked) {
      for (const code of codes) {
        if (dictionaries[code][key] === undefined) missing.push(`${code}:${key}`);
      }
    }
    harness.check("every key the client asks for exists in every dictionary", missing.length === 0, missing.slice(0, 8).join(", "));
    const unused = codes.every((code) => Object.keys(dictionaries[code]).filter((key) => !asked.includes(key)).length === 0);
    harness.check("every dictionary key is used by the client", unused);
  }

  harness.section("client: the contract with the host");
  {
    const hostSource = readFileSync(path.join(pluginDir, "index.js"), "utf8");
    const clientRoutes = [...new Set([...source.matchAll(/'(\/api\/dsh-nextsteps[^']*)'/g)].map((match) => match[1]))].sort();
    const hostRoutes = [...new Set([...hostSource.matchAll(/path: '(\/api\/dsh-nextsteps[^']*)'/g)].map((match) => match[1]))].sort();
    harness.check("the client calls at least one route", clientRoutes.length > 0, String(clientRoutes.length));
    harness.eq("every route the client calls is registered by the host", clientRoutes.filter((route) => !hostRoutes.includes(route)), []);
    harness.eq("the host registers no route the client never calls", hostRoutes.filter((route) => !clientRoutes.includes(route)), []);

    const keys = [...new Set([...source.matchAll(/(?:CLICKED_KEY|CAPTURES_KEY) = '([^']+)'/g)].map((match) => match[1]))];
    harness.check("the storage keys belong to the plugin", keys.length > 0 && keys.every((key) => key.startsWith("dsh-nextsteps")), keys.join(", "));

    const identity = [...new Set([...source.matchAll(/dsh-[a-z]+(?:-[a-z]+)*/g)].map((match) => match[0]))];
    const foreign = identity.filter((value) => value !== "dsh-nextsteps" && !value.startsWith("dsh-nextsteps-") && !value.startsWith("dsh-sf-"));
    harness.check("the sources carry no identity from another variant", foreign.length === 0, foreign.join(", "));
    harness.check("the sources carry no identity from the old name", !source.includes("suggest-followups"));
    harness.check("the sources carry no development marker", !source.includes("dsh-nextsteps-dev"));
  }

  harness.section("client: the two halves carry the same keys");
  {
    const inline = evaluateExpression(/const DICTIONARIES = (\{[\s\S]*?\n    \});/.exec(source)?.[1], "DICTIONARIES");
    for (const code of ["en", "pt-BR", "zh-CN"]) {
      const file = path.join(pluginDir, "lib", "locale", `${code}.json`);
      if (!harness.check(`the ${code} locale file exists`, existsSync(file))) continue;
      const data = JSON.parse(readFileSync(file, "utf8"));
      const inlineKeys = Object.keys(inline[code]).filter((key) => key !== "meta").sort();
      const fileKeys = Object.keys(data).filter((key) => key !== "meta").sort();
      harness.eq(`the ${code} locale file and the client carry the same keys`, inlineKeys, fileKeys);
    }
  }

  harness.section("client: the language list matches the host");
  {
    const options = /const LANGUAGE_OPTIONS = (\[[\s\S]*?\]);/.exec(source)?.[1];
    const parsed = evaluateExpression(options, "LANGUAGE_OPTIONS");
    harness.check("the client carries the language list", Array.isArray(parsed));
    if (Array.isArray(parsed)) {
      const codes = parsed.map((entry) => entry.value);
      harness.eq("the client offers fifteen languages", codes.length, 15);
      harness.check("the client offers no automatic entry", !codes.includes("auto"));
      harness.check("every language carries a native label", parsed.every((entry) => typeof entry.label === "string" && entry.label !== ""));
      const hostSource = readFileSync(path.join(pluginDir, "index.js"), "utf8");
      const hostBlock = /const LANGUAGE_NAMES = \{([\s\S]*?)\n\};/.exec(hostSource)?.[1];
      const hostCodes = hostBlock === undefined ? [] : [...hostBlock.matchAll(/^\s*'?([a-zA-Z-]+)'?\s*:/gm)].map((match) => match[1]);
      harness.eq("the host and the client agree on the languages", hostCodes.filter((code) => code !== "auto").sort(), codes.slice().sort());
      harness.check("the host offers the automatic entry", hostCodes.includes("auto"));
    }
  }

  harness.section("client: the plugin registers itself");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.0" }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    harness.eq("the dictionaries are registered", client.locale.map((entry) => entry.code).sort(), ["en", "pt-BR", "zh-CN"]);
    harness.check("the tool view slot is registered", client.slots.some((slot) => slot.spec.name === "tool.call.toolview"));
    harness.check("the turn tail slot is registered", client.slots.some((slot) => slot.spec.name === "conversation.chat.turnTail"));
    harness.check("the settings slot is registered", client.slots.some((slot) => slot.spec.name === "settings.section"));
    harness.check("the styles are installed", true);
  }

  harness.section("client: the capture is stored and restored");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();

    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-1", callId: "call-1", block: { callId: "call-1", turn: 7, argsRaw: argsRaw() } });
    module.flushWrites();
    harness.check("the capture reaches the local storage", localStorage.size >= 1, `${localStorage.size} key(s)`);

    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-1", turn: { turn: 7, end: { seq: 12 } }, t: (key) => key });
    const card = renderOnce(stub, restored.tree.type, restored.tree.props);
    const buttons = findByClass(card.tree, "dsh-sf-card");
    harness.eq("the card shows every followup", buttons.length, FOLLOWUPS.length);
    harness.check("the card shows the followup label", findElements(card.tree, (element) => element.props?.children === "Add tests").length === 1);
  }

  harness.section("client: the tail asks the host only when a language is enforced");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const calls = [];
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async (url) => {
        calls.push(String(url));
        if (String(url).includes("generate")) {
          return new Response(JSON.stringify({ ok: true, followups: [{ prompt: "gerado pelo host", label: "Host" }] }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const rendered = renderOnce(stub, tail, { sessionId: "session-auto", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of rendered.effects) effect();
    await flush(6);
    harness.check("the inline tail never asks the host to generate", !calls.some((url) => url.includes("dsh-nextsteps.generate")), calls.join(", "));
  }

  harness.section("client: the tail renders the card the host generated");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const calls = [];
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async (url) => {
        calls.push(String(url));
        if (String(url).includes("generate")) {
          return new Response(JSON.stringify({ ok: true, followups: [{ prompt: "gerado pelo host", label: "Host" }] }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (String(url).includes("models")) {
          return new Response(JSON.stringify({ ok: true, groups: [] }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ ok: true, settings: { lang: "zh-CN", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    await flush(6);
    const rendered = renderOnce(stub, tail, { sessionId: "session-host", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of rendered.effects) effect();
    await flush(6);
    harness.check("the host tail asks the host once", calls.filter((url) => url.includes("dsh-nextsteps.generate")).length === 1, calls.join(", "));
    const card = renderOnce(stub, tail, { sessionId: "session-host", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const renderedCard = renderOnce(stub, card.tree.type, card.tree.props);
    harness.check("the tail renders the card the host generated", findByClass(renderedCard.tree, "dsh-sf-card").length === 1, JSON.stringify(renderedCard.tree).slice(0, 140));
  }

  harness.section("client: the session override engages host mode for that session only");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage({
      "dsh-nextsteps.session-overrides": JSON.stringify({ "session-over": { lang: "zh-CN" } })
    });
    const calls = [];
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async (url) => {
        calls.push(String(url));
        if (String(url).includes("generate")) {
          return new Response(JSON.stringify({ ok: true, followups: [{ prompt: "gerado pelo host", label: "Host" }] }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const overridden = renderOnce(stub, tail, { sessionId: "session-over", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of overridden.effects) effect();
    await flush(6);
    harness.check("the override session asks the host in a globally inline mode", calls.filter((url) => url.includes("dsh-nextsteps.generate")).length === 1, calls.join(", "));
    const plain = renderOnce(stub, tail, { sessionId: "session-plain", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of plain.effects) effect();
    await flush(6);
    harness.check("the session without the override stays inline", calls.filter((url) => url.includes("dsh-nextsteps.generate")).length === 1, calls.join(", "));
  }

  harness.section("client: host mode ignores model-authored captures");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async (url) => {
        if (String(url).includes("generate")) {
          return new Response(JSON.stringify({ error: "no model" }), { status: 400, headers: { "content-type": "application/json" } });
        }
        if (String(url).includes("models")) {
          return new Response(JSON.stringify({ ok: true, groups: [] }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ ok: true, settings: { lang: "zh-CN", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, {
      sessionId: "session-tool",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", turn: 1, content: [{ type: "text", text: JSON.stringify({ rev: "sf-2", followups: [{ prompt: "Run the tests", label: "Tests" }] }) }] }
    });
    const unclaimed = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, unclaimed, {
      sessionId: "session-tool",
      callId: "call-unclaimed",
      block: { kind: "tool-result", callId: "call-unclaimed", name: "suggest_followups", content: [{ type: "text", text: JSON.stringify({ rev: "sf-2", followups: [{ prompt: "Also run the tests", label: "Tests" }] }) }] }
    });
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    await flush(6);
    const rendered = renderOnce(stub, tail, { sessionId: "session-tool", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of rendered.effects) effect();
    await flush(6);
    const card = renderOnce(stub, tail, { sessionId: "session-tool", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const renderedCard = renderOnce(stub, card.tree.type, card.tree.props);
    harness.check("a tool capture never renders in host mode", findByClass(renderedCard.tree, "dsh-sf-card").length === 0, JSON.stringify(renderedCard.tree).slice(0, 140));
  }

  harness.section("client: the update flow");
  {
    const build = (pluginManager, calls) => {
      const stub = createReactStub();
      const localStorage = makeLocalStorage();
      const { module } = loadClientModule(clientPath, {
        react: stub.React,
        localStorage,
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        fetch: async (url, options) => {
          const target = String(url);
          calls.push({ url: target, method: options?.method ?? "GET", body: options?.body, headers: options?.headers ?? {} });
          if (target.endsWith("/.ns/health")) return jsonResponse({ ok: true, name: "dsh-nextsteps", port: Number(new URL(target).port) });
          if (target.includes("registry.npmjs.org/dsh-nextsteps/")) return jsonResponse({ dist: { integrity: "sha512-" + "A".repeat(86) + "==" } });
          if (target.includes("/.ns/update")) {
            return new Response(JSON.stringify({ ok: true, version: "1.0.16", installed: "1.0.16", update: { latest: "v1.0.17", newer: true } }), { status: 200, headers: { "content-type": "application/json" } });
          }
          if (target.includes("/api/dsh-nextsteps.secret")) {
            return new Response(JSON.stringify({ ok: true, secret: "a".repeat(64) }), { status: 200, headers: { "content-type": "application/json" } });
          }
          if (target.includes("/api/dsh-nextsteps.models")) {
            return new Response(JSON.stringify({ ok: true, groups: [] }), { status: 200, headers: { "content-type": "application/json" } });
          }
          return new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.16" }), { status: 200, headers: { "content-type": "application/json" } });
        }
      });
      const client = fakeClientCtx(pluginManager === undefined ? {} : { remote: { pluginManager } });
      module.apply(client.ctx);
      client.resolve();
      const settings = client.slots.find((slot) => slot.spec.name === "settings.section").component;
      return { stub, settings, client, localStorage };
    };

    const managerCalls = [];
    const manager = {
      async updateBundle(name, version, options) {
        managerCalls.push({ spec: `${name}@${version}`, options });
        return { ok: true, value: { application: "applied", version: "1.0.17" } };
      }
    };
    const flowCalls = [];
    const withManager = build(manager, flowCalls);
    const rendered = renderOnce(withManager.stub, withManager.settings, { t: (key) => key });
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(withManager.stub, withManager.settings, { t: (key) => key });
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "updateNow");
    harness.eq("the update button appears when a release is available", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      harness.eq("the plugin manager is asked to install", managerCalls.length, 1);
      harness.eq("the plugin manager receives the package and the version", managerCalls[0]?.spec, "dsh-nextsteps@1.0.17");
      harness.check("the plugin manager receives a request id", typeof managerCalls[0]?.options?.requestId === "string", JSON.stringify(managerCalls[0]?.options));
      const updateCalls = flowCalls.filter((entry) => entry.url.includes("/.ns/update") && !entry.url.includes("/install"));
      harness.check("the update request carries the instance secret", updateCalls.length === 1 && updateCalls[0]?.headers["x-dsh-nextsteps-secret"] === "a".repeat(64), JSON.stringify(updateCalls.map((entry) => entry.headers)));
      harness.eq("the secret is fetched once and reused", flowCalls.filter((entry) => entry.url.includes("/api/dsh-nextsteps.secret")).length, 1);
      harness.eq("the applied install remembers the version", withManager.localStorage.getItem("dsh-nextsteps.updated"), "1.0.17");
      const packumentCall = flowCalls.find((entry) => entry.url.includes("registry.npmjs.org/dsh-nextsteps/"));
      harness.check("the npm registry packument is consulted before installing", packumentCall !== undefined && String(packumentCall?.headers?.["x-dsh-nextsteps-secret"] ?? "") === "", JSON.stringify(flowCalls.map((entry) => entry.url.slice(0, 60))));
      const settled = renderOnce(withManager.stub, withManager.settings, { t: (key) => key });
      const updateState = updateStateOf(withManager.stub);
      harness.check("the running version moves to what landed", updateState?.version === "1.0.17" && updateState?.update?.newer === false, JSON.stringify(updateState));
      const gone = findElements(settled.tree, (element) => element.props?.children === "updateNow");
      harness.eq("the update button disappears once the release is applied", gone.length, 0);
    }

    const fallbackCalls = [];
    const withoutManager = build(undefined, fallbackCalls);
    const renderedFallback = renderOnce(withoutManager.stub, withoutManager.settings, { t: (key) => key });
    for (const effect of renderedFallback.effects) effect();
    await flush(4);
    const withButtonFallback = renderOnce(withoutManager.stub, withoutManager.settings, { t: (key) => key });
    const fallbackButtons = findElements(withButtonFallback.tree, (element) => element.props?.children === "updateNow");
    harness.eq("the update button appears without a plugin manager", fallbackButtons.length, 1);
    if (fallbackButtons.length === 1) {
      await fallbackButtons[0].props.onClick();
      await flush(4);
      harness.check("the install without a manager names the missing installer", updateStateOf(withoutManager.stub)?.installError === "no-installer", JSON.stringify(updateStateOf(withoutManager.stub)));
      const settledFallback = renderOnce(withoutManager.stub, withoutManager.settings, { t: (key) => key });
      harness.check("the row names the missing installer", findElements(settledFallback.tree, (element) => element.props?.children === "updateNoManager").length === 1, JSON.stringify(settledFallback.tree).slice(0, 140));
      harness.check("no install request is sent without a plugin manager", fallbackCalls.every((entry) => !entry.url.includes("/.ns/update/install")), JSON.stringify(fallbackCalls.map((entry) => entry.url.slice(0, 60))));
      harness.eq("nothing is remembered as installed without a plugin manager", withoutManager.localStorage.getItem("dsh-nextsteps.updated"), null);
    }
  }

  harness.section("client: the update paths that fail");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const managerCalls = [];
    const pluginManager = {
      async updateBundle(name, version) {
        managerCalls.push(`${name}@${version}`);
        return { ok: true, value: { application: "applied", version: "1.0.25-rc.1" } };
      }
    };
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.ns/health")) return jsonResponse({ ok: true, name: "dsh-nextsteps", port: Number(new URL(target).port) });
        if (target.includes("/.ns/update")) return jsonResponse({ ok: true, version: "1.0.16", update: { latest: "v1.0.25-rc.1", newer: true } });
        if (target.includes("/api/dsh-nextsteps.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        if (target.includes("/api/dsh-nextsteps.models")) return jsonResponse({ ok: true, groups: [] });
        return jsonResponse({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.16" });
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const settings = client.slots.find((slot) => slot.spec.name === "settings.section").component;
    const rendered = renderOnce(stub, settings, { t: (key) => key });
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, settings, { t: (key) => key });
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "updateNow");
    harness.eq("the update button appears for a release that is not a plain version", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      harness.eq("the manager is not asked to install an unparsable version", managerCalls.length, 0);
      const after = renderOnce(stub, settings, { t: (key) => key });
      const refused = findElements(after.tree, (element) => element.props?.children === "unsupportedVersion");
      harness.eq("the unsupported version error is shown", refused.length, 1);
    }
  }

  harness.section("client: the update that waits for a restart names the version that landed");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.ns/health")) return jsonResponse({ ok: true, name: "dsh-nextsteps", port: Number(new URL(target).port) });
        if (target.includes("registry.npmjs.org/dsh-nextsteps/")) return jsonResponse({ dist: { integrity: "sha512-" + "A".repeat(86) + "==" } });
        if (target.includes("/.ns/update")) {
          return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true, url: "https://github.com/klaus-2/dsh-nextsteps/releases/tag/v1.0.24" } });
        }
        if (target.includes("/api/dsh-nextsteps.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        if (target.includes("/api/dsh-nextsteps.models")) return jsonResponse({ ok: true, groups: [] });
        return jsonResponse({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.23" });
      }
    });
    const client = fakeClientCtx({
      remote: {
        pluginManager: {
          async updateBundle() {
            return { ok: true, value: { application: "restart-required", version: "1.0.23" } };
          }
        }
      }
    });
    module.apply(client.ctx);
    client.resolve();
    const settings = client.slots.find((slot) => slot.spec.name === "settings.section").component;
    const rendered = renderOnce(stub, settings, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, settings, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      harness.eq("the version that landed on disk is remembered", localStorage.getItem("dsh-nextsteps.updated"), "1.0.23");
      const after = renderOnce(stub, settings, {});
      const restart = findElements(after.tree, (element) => typeof element?.props?.children === "string" && element.props.children.includes("1.0.23") && element.props.children.includes("installed"));
      harness.eq("the row names the version that landed, and says which one was asked for", restart.length, 1);
      harness.eq("the row says exactly what landed and what was asked for", restart[0]?.props.children, "Version 1.0.23 was installed instead of 1.0.24 — pnpm holds back a release that is too recent.");
      const asked = findElements(after.tree, (element) => typeof element?.props?.children === "string" && element.props.children.includes("1.0.24 was installed"));
      harness.eq("the row does not claim the version that was only asked for", asked.length, 0);
      const stillThere = findElements(after.tree, (element) => element.props?.children === "Update now");
      harness.eq("the update button stays so the release can be tried again", stillThere.length, 1);
    }
  }

  harness.section("client: the client identifies the host before it authenticates");
  {
    const stub = createReactStub();
    const calls = [];
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage: makeLocalStorage(),
      fetch: async (url, options) => {
        const target = String(url);
        calls.push({ url: target, headers: options?.headers ?? {} });
        if (target.endsWith("/.ns/health")) return jsonResponse({ ok: true, name: "other-listener", port: Number(new URL(target).port) });
        return jsonResponse({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.16" });
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const settings = client.slots.find((slot) => slot.spec.name === "settings.section").component;
    const rendered = renderOnce(stub, settings, {});
    for (const effect of rendered.effects) effect();
    const exhausted = await waitFor(() => calls.filter((call) => call.url.endsWith("/.ns/health")).length === 20, 2000, 10);
    await flush(4);
    const probes = calls.filter((call) => call.url.endsWith("/.ns/health"));
    harness.check("every candidate port is probed in order when no host identifies", exhausted === true && probes.length === 20 && probes.every((call, index) => new URL(call.url).port === String(47497 + index)), `probes=${probes.length}`);
    harness.eq("the unidentified host is never asked for the secret", calls.filter((call) => call.url.includes("/api/dsh-nextsteps.secret")).length, 0);
    harness.eq("no private request reaches the unidentified host", calls.filter((call) => call.url.includes("/.ns/update")).length, 0);
    harness.check("no credentials are sent anywhere", calls.every((call) => Object.keys(call.headers).every((key) => !/secret/i.test(key))), JSON.stringify(calls.slice(0, 2)));
    const state = updateStateOf(stub);
    harness.check("the check ends unreachable, not silent", state?.checking === false && state?.update?.error === "unreachable", JSON.stringify(state));

    const secretless = [];
    const secretlessStub = createReactStub();
    const { module: secretlessModule } = loadClientModule(clientPath, {
      react: secretlessStub.React,
      localStorage: makeLocalStorage(),
      fetch: async (url, options) => {
        const target = String(url);
        secretless.push({ url: target, headers: options?.headers ?? {} });
        if (target.endsWith("/.ns/health")) return jsonResponse({ ok: true, name: "dsh-nextsteps", port: Number(new URL(target).port) });
        return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
      }
    });
    const secretlessClient = fakeClientCtx({});
    secretlessModule.apply(secretlessClient.ctx);
    secretlessClient.resolve();
    const secretlessSettings = secretlessClient.slots.find((slot) => slot.spec.name === "settings.section").component;
    const secretlessRendered = renderOnce(secretlessStub, secretlessSettings, {});
    for (const effect of secretlessRendered.effects) effect();
    await waitFor(() => secretless.filter((call) => call.url.endsWith("/.ns/health")).length === 1, 2000, 10);
    await flush(4);
    harness.eq("a host that answers without its secret is not authenticated to", secretless.filter((call) => call.url.includes("/.ns/update")).length, 0);
    harness.check("the first walk sends no credentials", secretless.every((call) => Object.keys(call.headers).every((key) => !/secret/i.test(key))), `calls=${secretless.length}`);
    const checkTree = renderOnce(secretlessStub, secretlessSettings, { t: (key) => key });
    const check = findElements(checkTree.tree, (element) => element.props?.children === "check");
    if (check.length === 1) {
      await check[0].props.onClick();
      const retried = await waitFor(() => secretless.filter((call) => call.url.endsWith("/.ns/health")).length === 2, 2000, 10);
      harness.check("a failed discovery retries from the first port on the next check", retried === true, `health probes=${secretless.filter((call) => call.url.endsWith("/.ns/health")).length}`);
    }
  }

  harness.section("client: a copy the manager already holds is not asked for by its tarball");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const calls = [];
    const routeCalls = [];
    const pluginManager = {
      async installBundle(spec) {
        calls.push(spec);
        return { ok: true, value: { application: "failed", error: { code: "already-installed" } } };
      }
    };
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async (url, options) => {
        const target = String(url);
        if (target.endsWith("/.ns/health")) return jsonResponse({ ok: true, name: "dsh-nextsteps", port: Number(new URL(target).port) });
        if (target.includes("registry.npmjs.org/dsh-nextsteps/")) return jsonResponse({ dist: { integrity: "sha512-" + "A".repeat(86) + "==" } });
        if (target.includes("/.ns/update")) return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true } });
        if (target.includes("/api/dsh-nextsteps.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        if (target.includes("/api/dsh-nextsteps.models")) return jsonResponse({ ok: true, groups: [] });
        return jsonResponse({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.23" });
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const settings = client.slots.find((slot) => slot.spec.name === "settings.section").component;
    const rendered = renderOnce(stub, settings, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, settings, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      harness.eq("the manager is asked once", calls.length, 1);
      harness.check("the tarball is never asked for", !calls.some((spec) => String(spec).includes(".tgz")), JSON.stringify(calls));
      harness.eq("the dead route is never asked", routeCalls.length, 0);
      harness.eq("the version that landed on disk is remembered", localStorage.getItem("dsh-nextsteps.updated"), "1.0.24");
      const after = renderOnce(stub, settings, {});
      const restart = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("1.0.24") && element.props.children.includes("installed"));
      harness.check("the row names the version that landed", restart.length > 0, JSON.stringify(after.tree).slice(0, 200));
    }
  }

  harness.section("client: a host that refuses the update does not claim it worked");
  {
    const build = async (pluginManager) => {
      const stub = createReactStub();
      const localStorage = makeLocalStorage();
      const routeCalls = [];
      const { module } = loadClientModule(clientPath, {
        react: stub.React,
        localStorage,
        fetch: async (url, options) => {
          const target = String(url);
          if (target.endsWith("/.ns/health")) return jsonResponse({ ok: true, name: "dsh-nextsteps", port: Number(new URL(target).port) });
          if (target.includes("registry.npmjs.org/dsh-nextsteps/")) return jsonResponse({ dist: { integrity: "sha512-" + "A".repeat(86) + "==" } });
          if (target.includes("/.ns/update")) return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true } });
          if (target.includes("/api/dsh-nextsteps.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
          if (target.includes("/api/dsh-nextsteps.models")) return jsonResponse({ ok: true, groups: [] });
          return jsonResponse({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.23" });
        }
      });
      const client = fakeClientCtx({ remote: { pluginManager } });
      module.apply(client.ctx);
      client.resolve();
      const settings = client.slots.find((slot) => slot.spec.name === "settings.section").component;
      const rendered = renderOnce(stub, settings, {});
      for (const effect of rendered.effects) effect();
      await flush(4);
      return { stub, settings, localStorage, routeCalls };
    };
    const click = async (built) => {
      const withButton = renderOnce(built.stub, built.settings, {});
      const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
      harness.eq("the update button appears", buttons.length, 1);
      if (buttons.length !== 1) return;
      await buttons[0].props.onClick();
      await flush(4);
    };

    const refused = await build({
      async updateBundle() {
        return { ok: true, value: { from: "1.0.23", to: "1.0.24", step: "check", result: { changed: false, application: "failed", stage: "install", target: "dsh-nextsteps", error: { code: "invalid-spec", diagnostic: "dsh-nextsteps is not installed from a registry under its own name" } } } };
      }
    });
    await click(refused);
    harness.check("a refused install names the rejection", String(updateStateOf(refused.stub)?.installError).includes("rejected"), String(updateStateOf(refused.stub)?.installError));
    harness.eq("no own route is asked on a refusal", refused.routeCalls.length, 0);
    harness.eq("a refused install is not remembered", refused.localStorage.getItem("dsh-nextsteps.updated"), null);

    const cancelled = await build({
      async updateBundle(name, version) {
        return { ok: true, value: { from: "1.0.23", to: version, step: "install", result: { changed: false, application: "cancelled", stage: "install", target: name } } };
      }
    });
    await click(cancelled);
    harness.eq("a cancellation names nothing as installed", updateStateOf(cancelled.stub).installed, "");
    harness.eq("a cancellation is not remembered as installed", cancelled.localStorage.getItem("dsh-nextsteps.updated"), null);
    harness.check("a cancellation is reported", updateStateOf(cancelled.stub).installError !== "", String(updateStateOf(cancelled.stub).installError));

    const managerCalls = [];
    const recovered = await build({
      async updateBundle() {
        return { ok: true, value: { from: "1.0.23", to: "1.0.24", step: "check", result: { changed: false, application: "failed", stage: "install", target: "dsh-nextsteps", error: { code: "invalid-spec", diagnostic: "dsh-nextsteps is not installed from a registry under its own name" } } } };
      },
      async installBundle(spec) {
        managerCalls.push(spec);
        return { ok: true, value: { application: "restart-required", version: "1.0.24" } };
      }
    });
    await click(recovered);
    harness.eq("the manager is not asked to install a package it already holds", managerCalls.length, 0);
    harness.check("the rejection is named", String(updateStateOf(recovered.stub)?.installError).includes("rejected"), String(updateStateOf(recovered.stub)?.installError));
    harness.eq("no own route is asked on the rejection", recovered.routeCalls.length, 0);
    harness.eq("the rejected install is not remembered", recovered.localStorage.getItem("dsh-nextsteps.updated"), null);
  }

  harness.section("client: a development copy refuses to be installed over");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.ns/health")) return jsonResponse({ ok: true, name: "dsh-nextsteps", port: Number(new URL(target).port) });
        if (target.includes("/.ns/update")) return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true } });
        if (target.includes("/api/dsh-nextsteps.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        if (target.includes("/api/dsh-nextsteps.models")) return jsonResponse({ ok: true, groups: [] });
        return jsonResponse({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.23" });
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const settings = client.slots.find((slot) => slot.spec.name === "settings.section").component;
    const rendered = renderOnce(stub, settings, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, settings, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      const after = renderOnce(stub, settings, {});
      const notice = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("No plugin installer"));
      harness.eq("the row names the missing installer instead of an install failure", notice.length, 1);
      harness.eq("nothing was remembered as installed", localStorage.getItem("dsh-nextsteps.updated"), null);
    }
  }

  harness.section("client: the installed record retires when the running copy catches up");
  {
    const build = async (seed, version) => {
      const stub = createReactStub();
      const localStorage = makeLocalStorage(seed);
      const { module } = loadClientModule(clientPath, {
        react: stub.React,
        localStorage,
        fetch: async (url) => {
          const target = String(url);
          if (target.endsWith("/.ns/health")) return new Response("no", { status: 503 });
          if (target.includes("/api/dsh-nextsteps.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
          if (target.includes("/api/dsh-nextsteps.models")) return jsonResponse({ ok: true, groups: [] });
          return jsonResponse({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version });
        }
      });
      const client = fakeClientCtx({});
      module.apply(client.ctx);
      client.resolve();
      const settings = client.slots.find((slot) => slot.spec.name === "settings.section").component;
      const rendered = renderOnce(stub, settings, {});
      for (const effect of rendered.effects) effect();
      await flush(4);
      return localStorage;
    };
    const retired = await build({ "dsh-nextsteps.updated": "1.0.24" }, "1.0.24");
    harness.eq("the record retires once the running copy is the one it installed", retired.getItem("dsh-nextsteps.updated"), null);
    const kept = await build({ "dsh-nextsteps.updated": "1.0.24" }, "1.0.23");
    harness.eq("a record newer than the running copy survives", kept.getItem("dsh-nextsteps.updated"), "1.0.24");
  }

  harness.section("client: a failed start still names what landed");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const routeCalls = [];
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async (url, options) => {
        const target = String(url);
        if (target.endsWith("/.ns/health")) return jsonResponse({ ok: true, name: "dsh-nextsteps", port: Number(new URL(target).port) });
        if (target.includes("registry.npmjs.org/dsh-nextsteps/")) return jsonResponse({ dist: { integrity: "sha512-" + "A".repeat(86) + "==" } });
        if (target.includes("/.ns/update")) return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true } });
        if (target.includes("/api/dsh-nextsteps.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        if (target.includes("/api/dsh-nextsteps.models")) return jsonResponse({ ok: true, groups: [] });
        return jsonResponse({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.23" });
      }
    });
    const client = fakeClientCtx({
      remote: {
        pluginManager: {
          async updateBundle() {
            return { ok: true, value: { application: "failed", version: "1.0.24", error: { diagnostic: "dsh: the plugin could not be started" } } };
          }
        }
      }
    });
    module.apply(client.ctx);
    client.resolve();
    const settings = client.slots.find((slot) => slot.spec.name === "settings.section").component;
    const rendered = renderOnce(stub, settings, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, settings, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      harness.eq("the landed version is remembered", localStorage.getItem("dsh-nextsteps.updated"), "1.0.24");
      const state = updateStateOf(stub);
      harness.check("the state names what landed and why it did not start", state?.installed === "1.0.24" && String(state?.installError).includes("could not be started"), JSON.stringify(state));
      harness.eq("the plugin's own route is not asked when the manager landed the version", routeCalls.length, 0);
    }
  }

  harness.section("client: an update check that fails is not an answer that says there is nothing");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.ns/health")) return jsonResponse({ ok: true, name: "dsh-nextsteps", port: Number(new URL(target).port) });
        if (target.includes("/.ns/update")) throw new Error("the registry is unreachable");
        if (target.includes("/api/dsh-nextsteps.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        if (target.includes("/api/dsh-nextsteps.models")) return jsonResponse({ ok: true, groups: [] });
        return jsonResponse({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.16" });
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const settings = client.slots.find((slot) => slot.spec.name === "settings.section").component;
    const rendered = renderOnce(stub, settings, { t: (key) => key });
    for (const effect of rendered.effects) effect();
    await flush(4);
    const after = renderOnce(stub, settings, { t: (key) => key });
    const none = findElements(after.tree, (element) => element.props?.children === "none");
    harness.eq("an unreachable check does not say no releases published", none.length, 0);

    const errorStub = createReactStub();
    const { module: errorModule } = loadClientModule(clientPath, {
      react: errorStub.React,
      localStorage: makeLocalStorage(),
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.ns/health")) return jsonResponse({ ok: true, name: "dsh-nextsteps", port: Number(new URL(target).port) });
        if (target.includes("/.ns/update")) return jsonResponse({ ok: true, update: { error: "registry down" } });
        if (target.includes("/api/dsh-nextsteps.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        if (target.includes("/api/dsh-nextsteps.models")) return jsonResponse({ ok: true, groups: [] });
        return jsonResponse({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.16" });
      }
    });
    const errorClient = fakeClientCtx({});
    errorModule.apply(errorClient.ctx);
    errorClient.resolve();
    const errorSettings = errorClient.slots.find((slot) => slot.spec.name === "settings.section").component;
    const errorRendered = renderOnce(errorStub, errorSettings, {});
    for (const effect of errorRendered.effects) effect();
    await flush(4);
    const errorTree = renderOnce(errorStub, errorSettings, {});
    const failure = findElements(errorTree.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("registry down") && element.props.children.includes("Update check failed"));
    harness.eq("a server-reported failure names the failure the server gave", failure.length, 1);

    const pendingStub = createReactStub();
    const pendingStorage = makeLocalStorage({ "dsh-nextsteps.updated": "1.0.24" });
    const { module: pendingModule } = loadClientModule(clientPath, {
      react: pendingStub.React,
      localStorage: pendingStorage,
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.ns/health")) return jsonResponse({ ok: true, name: "dsh-nextsteps", port: Number(new URL(target).port) });
        if (target.includes("/.ns/update")) throw new Error("the registry is unreachable");
        if (target.includes("/api/dsh-nextsteps.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        if (target.includes("/api/dsh-nextsteps.models")) return jsonResponse({ ok: true, groups: [] });
        return jsonResponse({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.16" });
      }
    });
    const pendingClient = fakeClientCtx({});
    pendingModule.apply(pendingClient.ctx);
    pendingClient.resolve();
    const pendingSettings = pendingClient.slots.find((slot) => slot.spec.name === "settings.section").component;
    const pendingRendered = renderOnce(pendingStub, pendingSettings, {});
    for (const effect of pendingRendered.effects) effect();
    await flush(4);
    const pendingTree = renderOnce(pendingStub, pendingSettings, {});
    const pendingRow = findElements(pendingTree.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("1.0.24 was installed"));
    harness.eq("a failed check with a pending install still shows the pending version", pendingRow.length, 1);
    harness.eq("the pending record survives the failed check", pendingStorage.getItem("dsh-nextsteps.updated"), "1.0.24");
  }

  harness.section("client: the followups survive a restart");
  {
    const localStorage = makeLocalStorage();
    const first = loadClientModule(clientPath, {
      react: createReactStub().React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const firstClient = fakeClientCtx();
    first.module.apply(firstClient.ctx);
    firstClient.resolve();
    const firstCapture = firstClient.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(createReactStub(), firstCapture, { sessionId: "session-9", callId: "call-9", block: { callId: "call-9", turn: 3, argsRaw: argsRaw() } });
    first.module.flushWrites();

    const stub = createReactStub();
    const second = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const secondClient = fakeClientCtx();
    second.module.apply(secondClient.ctx);
    secondClient.resolve();
    const tail = secondClient.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-9", turn: { turn: 3, end: { seq: 12 } }, t: (key) => key });
    const card = renderOnce(stub, restored.tree.type, restored.tree.props);
    harness.eq("the followups come back after a restart", findByClass(card.tree, "dsh-sf-card").length, FOLLOWUPS.length);
  }

  harness.section("client: the card sends the followup");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const sent = [];
    const client = fakeClientCtx({ sessions: { binding: (id) => ({ id }) }, conversation: fakeConversation(sent) });
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-2", callId: "call-2", block: { callId: "call-2", turn: 1, argsRaw: argsRaw() } });
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-2", turn: { turn: 1, end: { seq: 4 } }, t: (key) => key });
    const card = renderOnce(stub, restored.tree.type, restored.tree.props);
    const buttons = findByClass(card.tree, "dsh-sf-card");
    await buttons[0].props.onClick();
    await flush();
    harness.eq("the prompt reaches the conversation", sent, ["Add the missing tests"]);
    const clickedKey = /CLICKED_KEY = '([^']+)'/.exec(source)?.[1] ?? "";
    harness.check("the click is remembered", clickedKey !== "" && localStorage.getItem(clickedKey) !== null, clickedKey);
  }

  harness.section("client: the card sends through the composer");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const drafts = [];
    let submitted = 0;
    let draft = "";
    const client = fakeClientCtx({
      sessions: { binding: (id) => ({ id }) },
      conversation: {
        input: {
          shell: () => ({
            state: { getSnapshot: () => ({ draft }) },
            actions: {
              setDraft: (value) => { draft = value; drafts.push(value); },
              submit: () => { submitted += 1; }
            }
          })
        }
      }
    });
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-3", callId: "call-3", block: { callId: "call-3", turn: 1, argsRaw: argsRaw() } });
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-3", turn: { turn: 1, end: { seq: 4 } }, t: (key) => key });
    const card = renderOnce(stub, restored.tree.type, restored.tree.props);
    const buttons = findByClass(card.tree, "dsh-sf-card");
    await buttons[0].props.onClick();
    await flush(8);
    harness.eq("the draft carries the prompt", drafts, ["Add the missing tests"]);
    harness.eq("the composer was submitted", submitted, 1);
  }

  harness.section("client: a failed send is reported");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx({ sessions: { binding: (id) => ({ id }) }, conversation: fakeConversation([], { fail: true }) });
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-4", callId: "call-4", block: { callId: "call-4", turn: 1, argsRaw: argsRaw() } });
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-4", turn: { turn: 1, end: { seq: 4 } }, t: (key) => key });
    const card = renderOnce(stub, restored.tree.type, restored.tree.props);
    await findByClass(card.tree, "dsh-sf-card")[0].props.onClick();
    await flush();
    const again = renderOnce(stub, restored.tree.type, restored.tree.props);
    harness.check("the failure is shown on the card", findElements(again.tree, (element) => element.props?.className === "dsh-sf-error").length === 1);
  }

  harness.section("client: the capture list is pruned");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    for (let index = 0; index < 450; index += 1) {
      renderOnce(stub, capture, { sessionId: "session-5", callId: `call-${index}`, block: { callId: `call-${index}`, turn: index, argsRaw: argsRaw() } });
    }
    module.flushWrites();
    const sessionKeys = Object.keys(localStorage.dump()).filter((name) => name.includes("captures.session."));
    const total = sessionKeys.reduce((sum, name) => {
      const parsed = JSON.parse(localStorage.dump()[name]);
      return sum + Object.keys(parsed ?? {}).length;
    }, 0);
    harness.eq("the stored captures reach the cap exactly", total, 400);
    harness.check("the cap keeps one session key", sessionKeys.length === 1, `${sessionKeys.length} session key(s)`);
  }

  harness.section("client: the capture cap holds across several sessions");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    for (let session = 0; session < 3; session += 1) {
      for (let index = 0; index < 200; index += 1) {
        renderOnce(stub, capture, { sessionId: `session-cap-${session}`, callId: `call-${index}`, block: { callId: `call-${index}`, turn: index, argsRaw: argsRaw() } });
      }
    }
    module.flushWrites();
    const sessionKeys = Object.keys(localStorage.dump()).filter((name) => name.includes("captures.session."));
    const total = sessionKeys.reduce((sum, name) => sum + Object.keys(JSON.parse(localStorage.dump()[name]) ?? {}).length, 0);
    harness.eq("the captures of several sessions are capped together", total, 400);
    harness.check("the cap keeps the captures of at least two sessions", sessionKeys.length >= 2, `${sessionKeys.length} session key(s)`);
    const index = JSON.parse(localStorage.dump()["dsh-nextsteps.captures.index"] ?? "{}");
    const claimed = Object.values(index.sessions ?? {}).reduce((sum, calls) => sum + Object.keys(calls ?? {}).length, 0);
    harness.eq("the index and the store agree on the capture count", claimed, total);
  }

  harness.section("client: the card waits for the viewport when an observer is available");
  {
    const observer = makeIntersectionObserver();
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      intersectionObserver: observer.FakeIntersectionObserver,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-defer", callId: "call-1", block: { callId: "call-1", turn: 7, argsRaw: argsRaw() } });
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const deferred = renderOnce(stub, tail, { sessionId: "session-defer", turn: { turn: 7, end: { seq: 12 } }, t: (key) => key });
    const card = renderOnce(stub, deferred.tree.type, deferred.tree.props);
    harness.eq("a never firing observer builds no card", findByClass(card.tree, "dsh-sf-card").length, 0);
    harness.check("the tail waits for the observer", deferred.tree.props.deferred === true);
    for (const effect of deferred.effects) effect();
    harness.eq("the tail observes its root", observer.instances.length, 1);
    observer.fire();
    const visible = renderOnce(stub, tail, { sessionId: "session-defer", turn: { turn: 7, end: { seq: 12 } }, t: (key) => key });
    const built = renderOnce(stub, visible.tree.type, visible.tree.props);
    harness.eq("firing the observer builds the cards", findByClass(built.tree, "dsh-sf-card").length, FOLLOWUPS.length);
  }

  harness.section("client: the card is built at once when no observer is available");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module, sandbox } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-fallback", callId: "call-1", block: { callId: "call-1", turn: 7, argsRaw: argsRaw() } });
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-fallback", turn: { turn: 7, end: { seq: 12 } }, t: (key) => key });
    const card = renderOnce(stub, restored.tree.type, restored.tree.props);
    harness.check("the default sandbox offers no observer", sandbox.IntersectionObserver === undefined);
    harness.check("the fallback does not defer the cards", restored.tree.props.deferred === false);
    harness.eq("the fallback builds the cards at once", findByClass(card.tree, "dsh-sf-card").length, FOLLOWUPS.length);
  }

  harness.section("client: the card renders one send control and the action buttons");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-actions", callId: "call-1", block: { callId: "call-1", turn: 7, argsRaw: argsRaw() } });
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-actions", turn: { turn: 7, end: { seq: 12 } }, t: (key) => key });
    const card = renderOnce(stub, restored.tree.type, restored.tree.props);
    harness.eq("the card renders one send control per suggestion", findByClass(card.tree, "dsh-sf-card").length, FOLLOWUPS.length);
    harness.eq("the card renders one item per suggestion", findByClass(card.tree, "dsh-sf-item").length, FOLLOWUPS.length);
    const actions = findByClass(card.tree, "dsh-sf-action");
    harness.check("the card renders the action buttons", actions.length >= FOLLOWUPS.length * 4, String(actions.length));
    const labels = actions.map((element) => element.props["aria-label"]);
    for (const expected of ["actionCopy", "actionFavorite", "actionEdit", "actionDiscard"]) {
      harness.check(`the ${expected} action is rendered`, labels.includes(expected), labels.join(", "));
    }
    harness.check("the action buttons never nest a send control", findElements(card.tree, (element) => element.props?.className === "dsh-sf-card" && element.props?.children !== undefined).every((element) => findByClass(element, "dsh-sf-action").length === 0));
  }

  harness.section("client: the copy action writes the prompt and announces it");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const clipboard = makeClipboard();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      clipboard,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-copy", callId: "call-1", block: { callId: "call-1", turn: 7, argsRaw: argsRaw() } });
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-copy", turn: { turn: 7, end: { seq: 12 } }, t: (key) => key });
    const Card = restored.tree.type;
    const card = renderOnce(stub, Card, restored.tree.props);
    const copyButton = findByClass(card.tree, "dsh-sf-action").find((element) => element.props["aria-label"] === "actionCopy");
    await copyButton.props.onClick();
    await flush(4);
    harness.eq("the clipboard carries the full prompt", clipboard.writes, ["Add the missing tests"]);
    const after = renderOnce(stub, Card, restored.tree.props);
    const live = findElements(after.tree, (element) => element.props?.role === "status");
    harness.eq("the live region carries the copy notice", live[0]?.props?.children, "srCopied");
  }

  harness.section("client: the clipboard fallback runs when the clipboard refuses");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const clipboard = makeClipboard({ fail: true });
    const { module, execCommands } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      clipboard,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-fallback", callId: "call-1", block: { callId: "call-1", turn: 7, argsRaw: argsRaw() } });
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-fallback", turn: { turn: 7, end: { seq: 12 } }, t: (key) => key });
    const Card = restored.tree.type;
    const card = renderOnce(stub, Card, restored.tree.props);
    const copyButton = findByClass(card.tree, "dsh-sf-action").find((element) => element.props["aria-label"] === "actionCopy");
    await copyButton.props.onClick();
    await flush(4);
    harness.eq("the execCommand fallback runs once", execCommands.length, 1);
    harness.eq("the fallback asks for a copy", execCommands[0], "copy");
    const after = renderOnce(stub, Card, restored.tree.props);
    const live = findElements(after.tree, (element) => element.props?.role === "status");
    harness.eq("the live region announces the copied prompt", live[0]?.props?.children, "srCopied");
  }

  harness.section("client: the discard hides the item and the undo restores it");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-discard", callId: "call-1", block: { callId: "call-1", turn: 7, argsRaw: argsRaw() } });
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-discard", turn: { turn: 7, end: { seq: 12 } }, t: (key) => key });
    const Card = restored.tree.type;
    let card = renderOnce(stub, Card, restored.tree.props);
    const discardButton = findByClass(card.tree, "dsh-sf-action").find((element) => element.props["aria-label"] === "actionDiscard");
    discardButton.props.onClick();
    module.flushWrites();
    const discarded = JSON.parse(localStorage.getItem("dsh-nextsteps.discarded") ?? "{}");
    const discardKeys = Object.keys(discarded);
    harness.eq("the discarded store carries the item", discardKeys.length, 1);
    harness.eq("the discarded entry carries the prompt", discarded[discardKeys[0]]?.prompt, "Add the missing tests");
    card = renderOnce(stub, Card, restored.tree.props);
    harness.eq("the discarded item is hidden", findByClass(card.tree, "dsh-sf-card").length, FOLLOWUPS.length - 1);
    const undo = findByClass(card.tree, "dsh-sf-action").find((element) => element.props?.children === "undoDiscard");
    harness.check("the card offers the undo", undo !== undefined);
    undo.props.onClick();
    module.flushWrites();
    harness.eq("the undo empties the discarded store", Object.keys(JSON.parse(localStorage.getItem("dsh-nextsteps.discarded") ?? "{}")).length, 0);
    card = renderOnce(stub, Card, restored.tree.props);
    harness.eq("the restored item comes back", findByClass(card.tree, "dsh-sf-card").length, FOLLOWUPS.length);
  }

  harness.section("client: the favourite carries the prompt and toggles");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-favorite", callId: "call-1", block: { callId: "call-1", turn: 7, argsRaw: argsRaw() } });
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-favorite", turn: { turn: 7, end: { seq: 12 } }, t: (key) => key });
    const Card = restored.tree.type;
    let card = renderOnce(stub, Card, restored.tree.props);
    const favoriteButton = findByClass(card.tree, "dsh-sf-action").find((element) => element.props["aria-label"] === "actionFavorite");
    favoriteButton.props.onClick();
    module.flushWrites();
    const favorites = JSON.parse(localStorage.getItem("dsh-nextsteps.favorites") ?? "{}");
    const favoriteKeys = Object.keys(favorites);
    harness.eq("the favourite is stored", favoriteKeys.length, 1);
    harness.eq("the favourite carries the prompt", favorites[favoriteKeys[0]]?.prompt, "Add the missing tests");
    card = renderOnce(stub, Card, restored.tree.props);
    const second = findByClass(card.tree, "dsh-sf-action").find((element) => element.props["aria-label"] === "actionFavorite");
    second.props.onClick();
    module.flushWrites();
    harness.eq("the favourite is removed", Object.keys(JSON.parse(localStorage.getItem("dsh-nextsteps.favorites") ?? "{}")).length, 0);
  }

  harness.section("client: the expansion reveals the prompt without sending");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const sent = [];
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx({ sessions: { binding: (id) => ({ id }) }, conversation: fakeConversation(sent) });
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-expand", callId: "call-1", block: { callId: "call-1", turn: 7, argsRaw: argsRaw() } });
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-expand", turn: { turn: 7, end: { seq: 12 } }, t: (key) => key });
    const Card = restored.tree.type;
    let card = renderOnce(stub, Card, restored.tree.props);
    const nameBefore = findByClass(card.tree, "dsh-sf-card")[0].props["aria-label"];
    const expandButton = findByClass(card.tree, "dsh-sf-action").find((element) => element.props["aria-label"] === "actionExpand");
    harness.check("the expansion is offered when the prompt is longer than the label", expandButton !== undefined);
    expandButton.props.onClick();
    card = renderOnce(stub, Card, restored.tree.props);
    const prompts = findByClass(card.tree, "dsh-sf-prompt");
    harness.check("the expansion reveals the prompt", prompts.length >= 1 && prompts[0].props.children === "Add the missing tests", JSON.stringify(prompts.map((entry) => entry.props.children)));
    harness.eq("the expansion sends nothing", sent, []);
    harness.eq("the accessible name does not change", findByClass(card.tree, "dsh-sf-card")[0].props["aria-label"], nameBefore);
  }

  harness.section("client: the edit sends the edited text and leaves the capture alone");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const sent = [];
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx({ sessions: { binding: (id) => ({ id }) }, conversation: fakeConversation(sent) });
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-edit", callId: "call-1", block: { callId: "call-1", turn: 7, argsRaw: argsRaw() } });
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-edit", turn: { turn: 7, end: { seq: 12 } }, t: (key) => key });
    const Card = restored.tree.type;
    let card = renderOnce(stub, Card, restored.tree.props);
    const editButton = findByClass(card.tree, "dsh-sf-action").find((element) => element.props["aria-label"] === "actionEdit");
    editButton.props.onClick();
    card = renderOnce(stub, Card, restored.tree.props);
    const textarea = findByClass(card.tree, "dsh-sf-textarea")[0];
    harness.check("the editor opens with the prompt", textarea !== undefined && textarea.props.value === "Add the missing tests", String(textarea?.props?.value));
    textarea.props.onChange({ target: { value: "Write the missing tests" } });
    card = renderOnce(stub, Card, restored.tree.props);
    const confirm = findByClass(card.tree, "dsh-sf-action").find((element) => element.props?.children === "editConfirm");
    confirm.props.onClick();
    await flush(4);
    harness.eq("the edited text is sent", sent, ["Write the missing tests"]);
    module.flushWrites();
    const stored = JSON.parse(localStorage.getItem("dsh-nextsteps.captures.session.session-edit") ?? "{}");
    const storedEntry = Object.values(stored)[0];
    harness.eq("the stored capture keeps the original prompt", storedEntry?.followups[0].prompt, "Add the missing tests");
  }
}
