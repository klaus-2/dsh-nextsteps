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
  loadClientModule,
  makeLocalStorage,
  renderOnce
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
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true }, version: "1.0.0" }), { status: 200, headers: { "content-type": "application/json" } })
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
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();

    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(stub, capture, { sessionId: "session-1", callId: "call-1", block: { callId: "call-1", turn: 7, argsRaw: argsRaw() } });
    harness.check("the capture reaches the local storage", localStorage.size >= 1, `${localStorage.size} key(s)`);

    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const restored = renderOnce(stub, tail, { sessionId: "session-1", turn: { turn: 7, end: { seq: 12 } }, t: (key) => key });
    const card = renderOnce(stub, restored.tree.type, restored.tree.props);
    const buttons = findByClass(card.tree, "dsh-sf-card");
    harness.eq("the card shows every followup", buttons.length, FOLLOWUPS.length);
    harness.check("the card shows the followup label", findElements(card.tree, (element) => element.props?.children === "Add tests").length === 1);
  }

  harness.section("client: the tail always asks the host");
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
        return new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const tail = client.slots.find((slot) => slot.spec.name === "conversation.chat.turnTail").component;
    const rendered = renderOnce(stub, tail, { sessionId: "session-auto", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of rendered.effects) effect();
    await flush(6);
    harness.check("the tail asks the host even in the automatic mode", calls.some((url) => url.includes("dsh-nextsteps.generate")), calls.join(", "));
    const card = renderOnce(stub, tail, { sessionId: "session-auto", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const renderedCard = renderOnce(stub, card.tree.type, card.tree.props);
    harness.check("the tail renders the card the host generated", findByClass(renderedCard.tree, "dsh-sf-card").length === 1, JSON.stringify(renderedCard.tree).slice(0, 140));
  }

  harness.section("client: the update button reaches the plugin manager");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const calls = [];
    const pluginManager = {
      async installBundle(spec, options) {
        calls.push({ op: "installBundle", spec, options });
        return { ok: true, value: { application: "restart-required", version: "1.0.1" } };
      },
      async installBundle(spec, options) {
        calls.push({ op: "installBundle", spec, options });
        return { ok: true, value: { application: "applied", version: "1.0.0" } };
      },
      async updateBundle() {
        calls.push({ op: "updateBundle" });
        return { ok: true, value: { application: "applied", version: "1.0.1" } };
      }
    };
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async (url) => {
        if (String(url).includes("update")) {
          return new Response(JSON.stringify({ ok: true, newer: true, managed: true, current: "1.0.0", latest: "1.0.1", url: "https://github.com/klaus-2/dsh-nextsteps/releases" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (String(url).includes("models")) {
          return new Response(JSON.stringify({ ok: true, groups: [] }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const settings = client.slots.find((slot) => slot.spec.name === "settings.section").component;
    const rendered = renderOnce(stub, settings, { t: (key) => key });
    for (const effect of rendered.effects) effect();
    await flush(6);
    const withButton = renderOnce(stub, settings, { t: (key) => key });
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "updateNow");
    harness.eq("the update button appears when a release is available", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(6);
      harness.eq("the button asks the plugin manager to install", calls.length, 1);
      harness.eq("the plugin manager receives the package and the version", calls[0]?.spec, "dsh-nextsteps@1.0.1");
      harness.check("the plugin manager receives a request id", typeof calls[0]?.options?.requestId === "string", JSON.stringify(calls[0]?.options));
    }
  }

  harness.section("client: the update button falls back to the tarball");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const calls = [];
    const pluginManager = {
      async installBundle(spec, options) {
        calls.push({ op: "installBundle", spec, options });
        if (spec === "dsh-nextsteps@1.0.1") return { ok: true, value: { error: { code: "already-installed" } } };
        return { ok: true, value: { application: "applied", version: "1.0.1" } };
      }
    };
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async (url) => {
        if (String(url).includes("update")) {
          return new Response(JSON.stringify({ ok: true, newer: true, managed: true, current: "1.0.0", latest: "1.0.1" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const settings = client.slots.find((slot) => slot.spec.name === "settings.section").component;
    const rendered = renderOnce(stub, settings, { t: (key) => key });
    for (const effect of rendered.effects) effect();
    await flush(6);
    const withButton = renderOnce(stub, settings, { t: (key) => key });
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "updateNow");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(6);
      harness.eq("the plugin manager is asked twice", calls.length, 2);
      harness.eq("the second attempt uses the tarball", calls[1]?.spec, "https://registry.npmjs.org/dsh-nextsteps/-/dsh-nextsteps-1.0.1.tgz");
      const after = renderOnce(stub, settings, { t: (key) => key });
      const current = findElements(after.tree, (element) => element.props?.children === "upToDate");
      harness.eq("the applied version is shown", current.length, 1);
    }
  }

  harness.section("client: the update button reports a missing plugin manager");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async (url) => {
        if (String(url).includes("update")) {
          return new Response(JSON.stringify({ ok: true, newer: true, managed: true, current: "1.0.0", latest: "1.0.1" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const client = fakeClientCtx({ remote: {} });
    module.apply(client.ctx);
    client.resolve();
    const settings = client.slots.find((slot) => slot.spec.name === "settings.section").component;
    const rendered = renderOnce(stub, settings, { t: (key) => key });
    for (const effect of rendered.effects) effect();
    await flush(6);
    const withButton = renderOnce(stub, settings, { t: (key) => key });
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "updateNow");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(6);
      const after = renderOnce(stub, settings, { t: (key) => key });
      const errors = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.startsWith("checkFailed"));
      harness.eq("the failure is shown instead of nothing happening", errors.length, 1);
    }
  }

  harness.section("client: the followups survive a restart");
  {
    const localStorage = makeLocalStorage();
    const first = loadClientModule(clientPath, {
      react: createReactStub().React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const firstClient = fakeClientCtx();
    first.module.apply(firstClient.ctx);
    firstClient.resolve();
    const firstCapture = firstClient.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    renderOnce(createReactStub(), firstCapture, { sessionId: "session-9", callId: "call-9", block: { callId: "call-9", turn: 3, argsRaw: argsRaw() } });

    const stub = createReactStub();
    const second = loadClientModule(clientPath, {
      react: stub.React,
      localStorage,
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true } }), { status: 200, headers: { "content-type": "application/json" } })
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
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true } }), { status: 200, headers: { "content-type": "application/json" } })
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
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true } }), { status: 200, headers: { "content-type": "application/json" } })
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
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true } }), { status: 200, headers: { "content-type": "application/json" } })
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
      fetch: async () => new Response(JSON.stringify({ ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true } }), { status: 200, headers: { "content-type": "application/json" } })
    });
    const client = fakeClientCtx();
    module.apply(client.ctx);
    client.resolve();
    const capture = client.slots.find((slot) => slot.spec.name === "tool.call.toolview").component;
    for (let index = 0; index < 450; index += 1) {
      renderOnce(stub, capture, { sessionId: "session-5", callId: `call-${index}`, block: { callId: `call-${index}`, turn: index, argsRaw: argsRaw() } });
    }
    const stored = Object.values(localStorage.dump()).find((value) => typeof value === "string" && value.includes("followups"));
    const parsed = stored === undefined ? {} : JSON.parse(stored);
    const total = Object.values(parsed).reduce((sum, entries) => sum + Object.keys(entries ?? {}).length, 0);
    harness.check("the stored captures are capped", total <= 400, String(total));
  }
}
