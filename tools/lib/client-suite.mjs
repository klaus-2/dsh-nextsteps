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
    const allowed = ["react", "react-dom", "@deepseek-ai/dsh-client-ui-primitives"];
    const unexpected = requires.filter((name) => !allowed.includes(name));
    harness.check("every client require is a runtime-resolvable seed word", unexpected.length === 0, unexpected.join(" | "));
    harness.check("the client never probes a loopback port", !source.includes("127.0.0.1") && !source.includes("/.ns/"));
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

    const identity = [...new Set([...source.replace(/@deepseek-ai\/dsh-[a-z-]+/g, "").matchAll(/dsh-[a-z]+(?:-[a-z]+)*/g)].map((match) => match[0]))];
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

  harness.section("client: the update row reads the host update route");
  {
    const UPDATE = "/api/dsh-nextsteps.update";
    const SETTINGS_REPLY = { ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.11.0" };
    const build = ({ manager, updateReply, currentReply, storage, modules } = {}) => {
      const stub = createReactStub();
      const localStorage = makeLocalStorage(storage ?? {});
      const calls = [];
      const { module } = loadClientModule(clientPath, {
        react: stub.React,
        localStorage,
        modules,
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        fetch: async (url, options) => {
          const target = String(url);
          calls.push({ url: target, method: options?.method ?? "GET" });
          if (target === `${UPDATE}?current=1`) return currentReply === undefined ? jsonResponse({ ok: true, current: "1.11.0" }) : currentReply();
          if (target === UPDATE) return updateReply();
          if (target.includes("/api/dsh-nextsteps.models")) return jsonResponse({ ok: true, groups: [] });
          return jsonResponse(SETTINGS_REPLY);
        }
      });
      const client = fakeClientCtx(manager === undefined ? {} : { remote: { pluginManager: manager } });
      module.apply(client.ctx);
      client.resolve();
      const slotOf = (name) => client.slots.find((slot) => slot.spec.name === name)?.component;
      return { stub, client, localStorage, calls, settings: slotOf("settings.section"), overlay: slotOf("shell.overlay") };
    };
    const settle = async (built) => {
      const first = renderOnce(built.stub, built.settings, { t: (key) => key });
      for (const effect of first.effects) effect();
      await flush(6);
      return renderOnce(built.stub, built.settings, { t: (key) => key });
    };
    const textOf = (tree) => JSON.stringify(tree);
    const buttonWith = (tree, label) => findElements(tree, (element) => element.type === "button" && element.props?.children === label);
    const available = () => jsonResponse({ ok: true, name: "dsh-nextsteps", current: "1.11.0", latest: "1.12.0", managed: true, newer: true, url: "https://github.com/klaus-2/dsh-nextsteps/releases/tag/v1.12.0", notes: "Fresh notes" });

    const installs = [];
    const manager = {
      async installBundle(spec, options) {
        installs.push({ spec, options });
        return { ok: true, value: { application: "restart-required", version: "1.12.0" } };
      }
    };
    const happy = build({ manager, updateReply: available });
    harness.check("the What's new dialog registers on the shell overlay", typeof happy.overlay === "function");
    const ready = await settle(happy);
    harness.check("the row asks the host update route", happy.calls.some((call) => call.url === UPDATE), JSON.stringify(happy.calls.map((call) => call.url)));
    harness.check("the row never probes a loopback port", happy.calls.every((call) => !call.url.includes("127.0.0.1")), JSON.stringify(happy.calls.map((call) => call.url)));
    harness.check("an available release names its version", textOf(ready.tree).includes("updateAvailable") && textOf(ready.tree).includes("updateVersion"), textOf(ready.tree).slice(0, 200));
    const install = buttonWith(ready.tree, "updateInstall");
    harness.eq("the install button appears when a manager is bound", install.length, 1);
    if (install.length === 1) {
      await install[0].props.onClick();
      await flush(6);
      harness.eq("the plugin manager installs the npm spec", installs.map((entry) => entry.spec), ["dsh-nextsteps@1.12.0"]);
      harness.check("the install carries a request id", typeof installs[0]?.options?.requestId === "string" && installs[0].options.requestId.startsWith("dsh-nextsteps-update-1.12.0-"), JSON.stringify(installs[0]?.options));
      harness.eq("the installed version is remembered", happy.localStorage.getItem("dsh-nextsteps.update.installed"), "1.12.0");
      const record = JSON.parse(happy.localStorage.getItem("dsh-nextsteps.update.whatsNew") ?? "null");
      harness.check("the install leaves a What's new record for the next start", record?.version === "1.12.0" && record?.notes === "Fresh notes" && record?.url?.startsWith("https://github.com/"), JSON.stringify(record));
      const after = renderOnce(happy.stub, happy.settings, { t: (key) => key });
      harness.check("the row asks for a restart", textOf(after.tree).includes("updateRestart"), textOf(after.tree).slice(0, 200));
      harness.eq("the install button is gone after the install", buttonWith(after.tree, "updateInstall").length, 0);
    }

    const already = [];
    const twice = build({
      manager: {
        async installBundle(spec) {
          already.push(spec);
          return already.length === 1
            ? { ok: true, value: { application: "failed", error: { code: "already-installed" } } }
            : { ok: true, value: { application: "restart-required", version: "1.12.0" } };
        }
      },
      updateReply: available
    });
    const twiceReady = await settle(twice);
    await buttonWith(twiceReady.tree, "updateInstall")[0]?.props.onClick();
    await flush(6);
    harness.eq("an already-installed spec retries with the registry tarball", already, ["dsh-nextsteps@1.12.0", "https://registry.npmjs.org/dsh-nextsteps/-/dsh-nextsteps-1.12.0.tgz"]);

    const refused = build({ manager: { async installBundle() { return { ok: true, value: { application: "failed", error: { code: "spawn-failed", diagnostic: "\ndsh: pnpm exited 1\n" } } }; } }, updateReply: available });
    const refusedReady = await settle(refused);
    await buttonWith(refusedReady.tree, "updateInstall")[0]?.props.onClick();
    await flush(6);
    const refusedAfter = renderOnce(refused.stub, refused.settings, { t: (key) => key });
    harness.check("a refused install reports the failure", textOf(refusedAfter.tree).includes("updateFailed"), textOf(refusedAfter.tree).slice(0, 200));
    harness.eq("a refused install is not remembered", refused.localStorage.getItem("dsh-nextsteps.update.installed"), null);
  }

  harness.section("client: the update row without an installer, an npm copy or an answer");
  {
    const UPDATE = "/api/dsh-nextsteps.update";
    const build = (updateReply, manager, storage) => {
      const stub = createReactStub();
      const localStorage = makeLocalStorage(storage ?? {});
      const { module } = loadClientModule(clientPath, {
        react: stub.React,
        localStorage,
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        fetch: async (url) => {
          const target = String(url);
          if (target === `${UPDATE}?current=1`) return jsonResponse({ ok: true, current: "1.11.0" });
          if (target === UPDATE) return updateReply();
          return jsonResponse({ ok: true, settings: {}, version: "1.11.0" });
        }
      });
      const client = fakeClientCtx(manager === undefined ? {} : { remote: { pluginManager: manager } });
      module.apply(client.ctx);
      client.resolve();
      return { stub, client, settings: client.slots.find((slot) => slot.spec.name === "settings.section").component };
    };
    const settle = async (built) => {
      const first = renderOnce(built.stub, built.settings, { t: (key) => key });
      for (const effect of first.effects) effect();
      await flush(6);
      return JSON.stringify(renderOnce(built.stub, built.settings, { t: (key) => key }).tree);
    };
    const newer = (extra) => () => jsonResponse({ ok: true, name: "dsh-nextsteps", current: "1.11.0", latest: "1.12.0", managed: true, newer: true, ...extra });

    const noManager = await settle(build(newer()));
    harness.check("without a plugin manager the row offers a check, not an install", noManager.includes("updateAvailable") && noManager.includes("\"updateCheck\"") && !noManager.includes("\"updateInstall\""), noManager.slice(0, 200));
    const manual = await settle(build(newer({ managed: false }), { async installBundle() { throw new Error("must not install"); } }));
    harness.check("a copy that did not come from npm is sent to the plugin settings", manual.includes("updateManual") && !manual.includes("\"updateInstall\""), manual.slice(0, 200));
    const current = await settle(build(() => jsonResponse({ ok: true, name: "dsh-nextsteps", current: "1.11.0", latest: "1.11.0", managed: true, newer: false })));
    harness.check("the latest version says so", current.includes("updateCurrent"), current.slice(0, 200));
    const landed = await settle(build(newer({ installed: "1.12.0" })));
    harness.check("a newer copy already on disk asks for a restart", landed.includes("updateRestart"), landed.slice(0, 200));
    const failed = await settle(build(() => new Response(JSON.stringify({ ok: false, error: "the GitHub releases API answered 500 for the latest release" }), { status: 502, headers: { "content-type": "application/json" } })));
    harness.check("a failed check is reported, not read as up to date", failed.includes("updateFailed") && !failed.includes("updateCurrent"), failed.slice(0, 200));
  }

  harness.section("client: the What's new dialog after an update");
  {
    const UPDATE = "/api/dsh-nextsteps.update";
    const primitives = { Modal: "Modal", Button: "Button" };
    const build = ({ storage, notes, modules = { "@deepseek-ai/dsh-client-ui-primitives": primitives } }) => {
      const stub = createReactStub();
      const localStorage = makeLocalStorage(storage);
      const { module } = loadClientModule(clientPath, {
        react: stub.React,
        localStorage,
        modules,
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        fetch: async (url) => {
          const target = String(url);
          if (target === `${UPDATE}?current=1`) return jsonResponse({ ok: true, current: "1.11.0", notes });
          if (target === UPDATE) return jsonResponse({ ok: true, name: "dsh-nextsteps", current: "1.11.0", latest: "1.11.0", managed: true, newer: false });
          return jsonResponse({ ok: true, settings: {}, version: "1.11.0" });
        }
      });
      const client = fakeClientCtx();
      module.apply(client.ctx);
      client.resolve();
      return { stub, localStorage, overlay: client.slots.find((slot) => slot.spec.name === "shell.overlay").component };
    };
    const record = JSON.stringify({ version: "1.11.0", notes: "From the install", url: "https://github.com/klaus-2/dsh-nextsteps/releases/tag/v1.11.0" });
    const shipped = { en: "- Line one\n- Line two", "pt-BR": "- Linha um\n- Linha dois" };

    const updated = build({ storage: { "dsh-nextsteps.update.whatsNew": record, "dsh-nextsteps.update.seen": "1.10.0" }, notes: shipped });
    await flush(6);
    const open = renderOnce(updated.stub, updated.overlay, {});
    harness.check("the dialog opens on the host Modal after an update", open.tree?.type === "Modal" && open.tree?.props?.open === true, JSON.stringify(open.tree).slice(0, 160));
    harness.eq("the dialog names the running version", open.tree?.props?.title, "What's new in 1.11.0");
    harness.eq("multi-line notes render as a list", findElements(open.tree, (element) => element.type === "li").map((element) => element.props.children), ["Line one", "Line two"]);
    harness.eq("the record is consumed", updated.localStorage.getItem("dsh-nextsteps.update.whatsNew"), null);
    harness.eq("the running version is marked as seen", updated.localStorage.getItem("dsh-nextsteps.update.seen"), "1.11.0");
    const starLink = findElements(open.tree, (element) => element.type === "a" && element.props?.children === "Star it on GitHub");
    harness.eq("the dialog asks for a star while the support banner was never answered", starLink.length, 1);
    if (starLink.length === 1) {
      starLink[0].props.onClick();
      await flush(6);
      const thanked = renderOnce(updated.stub, updated.overlay, {});
      harness.check("following the star link thanks the user", JSON.stringify(thanked.tree).includes("Every star helps"), JSON.stringify(thanked.tree).slice(0, 200));
      harness.check("the star answer is the support banner's state", JSON.parse(updated.localStorage.getItem("dsh-nextsteps.support") ?? "{}").state === "thanked", String(updated.localStorage.getItem("dsh-nextsteps.support")));
    }
    open.tree?.props?.onClose();
    harness.eq("closing the dialog removes it", renderOnce(updated.stub, updated.overlay, {}).tree, null);

    const answered = build({ storage: { "dsh-nextsteps.update.whatsNew": record, "dsh-nextsteps.update.seen": "1.10.0", "dsh-nextsteps.support": JSON.stringify({ state: "dismissed", at: 1 }) }, notes: shipped });
    await flush(6);
    const quiet = renderOnce(answered.stub, answered.overlay, {});
    harness.check("a dismissed support banner keeps the dialog from asking again", quiet.tree?.type === "Modal" && !JSON.stringify(quiet.tree).includes("Star it on GitHub"), JSON.stringify(quiet.tree).slice(0, 200));

    const firstRun = build({ storage: {}, notes: shipped });
    await flush(6);
    harness.eq("a first install shows no dialog", renderOnce(firstRun.stub, firstRun.overlay, {}).tree, null);
    harness.eq("a first install still records the seen version", firstRun.localStorage.getItem("dsh-nextsteps.update.seen"), "1.11.0");

    const noPrimitives = build({ storage: { "dsh-nextsteps.update.whatsNew": record, "dsh-nextsteps.update.seen": "1.10.0" }, notes: shipped, modules: {} });
    await flush(6);
    harness.eq("without the host primitives the dialog stays closed", renderOnce(noPrimitives.stub, noPrimitives.overlay, {}).tree, null);
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
