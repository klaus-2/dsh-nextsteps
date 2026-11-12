import { readFileSync } from "node:fs";
import path from "node:path";
import { suite, test, assert, assertEqual, assertIncludes, assertMatch, pluginId } from "../harness.mjs";
import { loadClient, fakeSlotHost, stubFetch, walk, textOf, memoryStorage, fakeIntersectionObserver, fakeClipboard } from "../client-harness.mjs";
import { root } from "../client-harness.mjs";

suite("client: rendering, dictionaries and persistence");

function settingsTree(client, props = {}) {
  const { ctx, registrations } = fakeSlotHost(client.react);
  client.instance.apply(ctx);
  const settings = registrations.find((entry) => entry.spec?.name === "settings.section");
  assert(settings !== undefined, "the settings section is registered");
  return { tree: settings.component({ t: (key) => key, ...props }), ctx, registrations };
}

test("the client module registers itself under its own id", () => {
  const { moduleId } = loadClient();
  assertEqual(moduleId, pluginId);
});

test("the client asks for the services it uses", () => {
  const { instance } = loadClient();
  assert(Array.isArray(instance.inject), "the client declares its inject list");
  assert(instance.inject.includes("slots"), "the client needs the slots service");
  assert(instance.inject.includes("locale"), "the client needs the locale service");
});

test("the client registers the three dictionaries", () => {
  const client = loadClient();
  const { ctx, dictionaries } = fakeSlotHost(client.react);
  client.instance.apply(ctx);
  const codes = [...dictionaries.keys()].map((key) => key.split("/")[1]);
  for (const lang of ["en", "pt-BR", "zh-CN"]) {
    assert(codes.includes(lang), `the ${lang} dictionary is registered`);
  }
});

test("the settings section renders every control", () => {
  const client = loadClient();
  const fetchStub = stubFetch({
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.update": { name: "dsh-nextsteps", current: "1.0.0", newer: false }
  });
  try {
    const { tree } = settingsTree(client);
    const selects = walk(tree, (node) => node.type === "select");
    const inputs = walk(tree, (node) => node.type === "input");
    const buttons = walk(tree, (node) => node.type === "button");
    assert(selects.length >= 1, "the settings page has a select");
    assert(inputs.length >= 2, "the followup count and the header toggle are inputs");
    assert(buttons.length >= 1, "the update row has its buttons");
  } finally {
    fetchStub.restore();
  }
});

test("the styles checkboxes follow the stored selection", async () => {
  const settings = { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["explore"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 };
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" } });
  try {
    await settled(client);
    const section = registrations.find((entry) => entry.spec?.name === "settings.section");
    const tree = section.component({ t: (key) => key });
    const boxes = walk(tree, (node) => node.type === "input" && node.props?.type === "checkbox" && node.props?.["aria-label"] !== undefined);
    const styles = boxes.filter((node) => ["styleNextAction", "styleExplore", "styleDeepDive"].includes(node.props["aria-label"]));
    assertEqual(styles.length, 3, "the settings page offers the three styles");
    const checked = styles.filter((node) => node.props.checked === true).map((node) => node.props["aria-label"]);
    assertEqual(checked, ["styleExplore"], "only the stored style is checked");
    const last = styles.find((node) => node.props["aria-label"] === "styleExplore");
    last.props.onChange({ target: { checked: false } });
    const posted = client.fetchStub.calls.filter((entry) => entry.method === "POST" && entry.url.includes(".settings"));
    assertEqual(posted.length, 0, "the last style cannot be unchecked");
  } finally {
    client.fetchStub.restore();
  }
});

test("the language select offers every language the host accepts", () => {
  const client = loadClient();
  const fetchStub = stubFetch({
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.update": { name: "dsh-nextsteps", current: "1.0.0", newer: false }
  });
  try {
    const { tree } = settingsTree(client);
    const languageSelect = walk(tree, (node) => node.type === "select" && node.props["aria-label"] === "setLanguage")[0];
    assert(languageSelect !== undefined, "the language select is labelled");
    const values = languageSelect.children.map((child) => child.props.value);
    assertEqual(values.length, 16, "auto plus fifteen languages");
    for (const expected of ["auto", "en", "pt-BR", "zh-CN", "es", "fr", "de", "ja", "ko", "ru", "ar", "hi", "tr", "vi"]) {
      assert(values.includes(expected), `the language select offers ${expected}`);
    }
  } finally {
    fetchStub.restore();
  }
});

test("the model row explains an empty catalog instead of waiting forever", () => {
  const client = loadClient();
  const fetchStub = stubFetch({
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.update": { name: "dsh-nextsteps", current: "1.0.0", newer: false }
  });
  try {
    const { tree } = settingsTree(client);
    const rows = walk(tree, (node) => node.type === "div" && typeof node.props.title === "string");
    const modelRow = rows.find((node) => node.props.title === "setModelTip");
    assert(modelRow !== undefined, "the model row is rendered");
    const text = textOf(modelRow);
    assert(text.length > 0, "the model row explains itself");
  } finally {
    fetchStub.restore();
  }
});

test("the followup count input keeps the bounds", () => {
  const client = loadClient();
  const fetchStub = stubFetch({
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.update": { name: "dsh-nextsteps", current: "1.0.0", newer: false }
  });
  try {
    const { tree } = settingsTree(client);
    const count = walk(tree, (node) => node.type === "input" && node.props.type === "number")[0];
    assert(count !== undefined, "the followup count is a number input");
    assertEqual(count.props.min, 1);
    assertEqual(count.props.max, 6);
  } finally {
    fetchStub.restore();
  }
});

test("the turn tail and the tool view are registered as slots", () => {
  const client = loadClient();
  const { ctx, registrations } = fakeSlotHost(client.react);
  client.instance.apply(ctx);
  const names = registrations.map((entry) => entry.spec?.name ?? entry.name);
  assert(names.includes("conversation.chat.turnTail"), "the tail slot is registered");
  assert(names.includes("tool.call.toolview"), "the tool view slot is registered");
  assert(names.includes("settings.section"), "the settings section is registered");
});

test("the captures survive a reload of the client", () => {
  const storage = memoryStorage();
  const client = loadClient({ storage });
  const { ctx, registrations } = fakeSlotHost(client.react);
  client.instance.apply(ctx);
  const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
  assert(capture !== undefined, "the capture is registered");
  capture.component({
    sessionId: "s1",
    callId: "call-1",
    block: {
      kind: "tool-result",
      callId: "call-1",
      name: "suggest_followups",
      content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }]
    }
  });
  client.instance.flushWrites();
  const key = Object.keys(storage._data).find((name) => name.includes("captures.session.s1"));
  assert(key !== undefined, "the captures are stored under a plugin owned key");
  assert(key.includes("dsh-nextsteps"), "the captures key belongs to the plugin");
  const parsed = JSON.parse(storage._data[key]);
  const entry = parsed["call-1"];
  assert(entry !== undefined, "the capture is stored under its session and call");
  assertEqual(entry.followups[0].label, "Rodar build");
});

test("a capture without a turn keeps no turn", () => {
  const storage = memoryStorage();
  const client = loadClient({ storage });
  const { ctx, registrations } = fakeSlotHost(client.react);
  client.instance.apply(ctx);
  const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
  capture.component({
    sessionId: "s2",
    callId: "call-2",
    block: {
      kind: "tool-result",
      callId: "call-2",
      name: "suggest_followups",
      content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"p2","label":"l2"}]}' }]
    }
  });
  client.instance.flushWrites();
  const key = Object.keys(storage._data).find((name) => name.includes("captures.session.s2"));
  assert(key !== undefined, "the capture is stored under its session key");
  const parsed = JSON.parse(storage._data[key]);
  assert(parsed["call-2"].turn === undefined, "a capture without a turn keeps no turn");
});

test("the tail renders no card for a turn without a capture", () => {
  const client = loadClient();
  const fetchStub = stubFetch({});
  const { ctx, registrations } = fakeSlotHost(client.react);
  client.instance.apply(ctx);
  const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail");
  assert(tail !== undefined, "the tail is registered");
  const tree = tail.component({ sessionId: "s1", turn: { turn: 3, end: { seq: 12 } }, t: (key) => key });
  const cards = walk(tree, (node) => String(node.props?.className ?? "").includes("dsh-sf-card"));
  assertEqual(cards.length, 0, "a turn without a capture renders no card");
  fetchStub.restore();
});

test("the client asks the host for its settings and its model catalog", async () => {
  const client = loadClient({ routes: {
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.update": { name: "dsh-nextsteps", current: "1.0.0", newer: false }
  } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const settings = registrations.find((entry) => entry.spec?.name === "settings.section");
    settings.component({ t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const urls = client.fetchStub.calls.map((call) => call.url);
    assert(urls.some((url) => url.includes(".settings")), `the client reads the settings: ${JSON.stringify(urls)}`);
    assert(urls.some((url) => url.includes(".models")), `the client reads the model catalog: ${JSON.stringify(urls)}`);
    assert(urls.every((url) => url.startsWith("/api/dsh-nextsteps.")), `the client only calls its own routes: ${JSON.stringify(urls)}`);
  } finally {
    client.fetchStub.restore();
  }
});

test("the inline tail makes no generation request", async () => {
  const client = loadClient({ routes: {
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] }
  } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail");
    tail.component({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const generated = client.fetchStub.calls.filter((entry) => entry.url.includes(".generate"));
    assertEqual(generated.length, 0, "the inline tail never asks the host to generate");
  } finally {
    client.fetchStub.restore();
  }
});

test("the host tail asks once and renders only the generated cards", async () => {
  const client = loadClient({ routes: {
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "zh-CN", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.generate": { ok: true, rev: "sf-2", followups: [{ prompt: "修复解析器", label: "修复" }] }
  } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", turn: 1, content: [{ type: "text", text: JSON.stringify({ rev: "sf-2", followups: [{ prompt: "Run the tests", label: "Tests" }] }) }] }
    });
    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail");
    tail.component({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const generated = client.fetchStub.calls.filter((entry) => entry.url.includes(".generate"));
    assertEqual(generated.length, 1, "the host tail asks exactly once");
    client.instance.flushWrites();
    const key = Object.keys(client.storage._data).find((name) => name.includes("captures.session.s1"));
    assert(key !== undefined, "the generated capture is stored under its session key");
    const store = JSON.parse(client.storage._data[key]);
    const keys = Object.keys(store);
    assert(keys.includes("generated-1"), "the generated capture is stored");
    const stored = store["generated-1"];
    assertEqual(stored.followups[0].prompt, "修复解析器", "the generated card wins over the tool capture");
    const tree = tail.component({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    client.react.__setComponent(tree.type);
    client.react.__reset();
    const rendered = tree.type(tree.props);
    const cards = walk(rendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-card"));
    assertEqual(cards.length, 1, "only the generated card renders in host mode");
  } finally {
    client.fetchStub.restore();
  }
});

test("the host tail warns once and shows no card when the generator fails", async () => {
  const client = loadClient({ routes: {
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "zh-CN", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] }
  } });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail");
    tail.component({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const generationWarnings = warnings.filter((line) => line.includes("generation failed"));
    assertEqual(generationWarnings.length, 1, "the failure warns exactly once");
    client.instance.flushWrites();
    const key = Object.keys(client.storage._data).find((name) => name.includes("captures.session.s1"));
    const store = key === undefined ? {} : JSON.parse(client.storage._data[key]);
    assertEqual(Object.keys(store).length, 0, "a failed generation stores no card");
    const tree = tail.component({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    client.react.__setComponent(tree.type);
    client.react.__reset();
    const rendered = tree.type(tree.props);
    const cards = walk(rendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-card"));
    assertEqual(cards.length, 0, "a failed generation renders no card");
  } finally {
    console.warn = originalWarn;
    client.fetchStub.restore();
  }
});

test("the client survives a host that answers with an empty body", async () => {
  const client = loadClient();
  const fetchStub = stubFetch({
    "/api/dsh-nextsteps.settings": "",
    "/api/dsh-nextsteps.models": "",
    "/api/dsh-nextsteps.update": ""
  });
  try {
    const { ctx } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(true, "an empty answer does not break the client");
  } finally {
    fetchStub.restore();
  }
});

const NEW_SETTINGS = { lang: "auto", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 };

function clientWithRoutes(routes, options = {}) {
  const client = loadClient({ routes, ...options });
  const { ctx, registrations } = fakeSlotHost(client.react);
  client.instance.apply(ctx);
  return { client, ctx, registrations };
}

async function settled(client) {
  await new Promise((resolve) => setTimeout(resolve, 30));
  for (const effect of client.react.__effects ?? []) await effect();
  await new Promise((resolve) => setTimeout(resolve, 30));
}

function tailOf(registrations) {
  const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail");
  assert(tail !== undefined, "the tail is registered");
  return tail.component;
}

function renderTail(client, tail, props) {
  const tree = tail(props);
  client.react.__setComponent(tree.type);
  client.react.__reset();
  return tree.type(tree.props);
}

function buttonsOf(tree) {
  return walk(tree, (node) => node.type === "button");
}

function buttonWithText(tree, text) {
  return buttonsOf(tree).find((node) => node.children.includes(text));
}

test("the send control is a button that sends the prompt", async () => {
  const sent = [];
  const client = loadClient({ routes: { "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    ctx.get = (name) => {
      if (name === "sessions") return { binding: (id) => ({ id }) };
      if (name === "conversation") return { binding: () => ({ send: async (text) => { sent.push(text); } }) };
      return undefined;
    };
    client.instance.apply(ctx);
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(registrations);
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const send = walk(rendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-card"))[0];
    assert(send !== undefined, "the card renders a send control");
    assertEqual(send.type, "button", "the send control is a button, so Enter activates it natively");
    assertEqual(send.props.disabled, false, "the send control starts enabled");
    await send.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assertEqual(sent, ["Rodar o build"], "the send control sends the prompt");
  } finally {
    client.fetchStub.restore();
  }
});

test("the card shortcuts run the copy, the favourite, the edit and the discard", async () => {
  const client = loadClient({ routes: { "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(registrations);
    const press = async (key) => {
      const tree = tail({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key2) => key2 });
      client.react.__setComponent(tree.type);
      client.react.__reset();
      const rendered = tree.type(tree.props);
      const item = walk(rendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-item"))[0];
      assert(item !== undefined, "the card item exists");
      let prevented = 0;
      item.props.onKeyDown({ key, target: { tagName: "DIV" }, preventDefault: () => { prevented += 1; } });
      return prevented;
    };
    assertEqual(await press("e"), 1, "the edit shortcut runs");
    assertEqual(await press("f"), 1, "the favourite shortcut runs");
    assertEqual(await press("c"), 1, "the copy shortcut runs");
    const tree = tail({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key2) => key2 });
    client.react.__setComponent(tree.type);
    client.react.__reset();
    const rendered = tree.type(tree.props);
    const item = walk(rendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-item"))[0];
    item.props.onKeyDown({ key: "Escape", target: { tagName: "DIV" }, preventDefault: () => {} });
    const after = tail({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key2) => key2 });
    client.react.__setComponent(after.type);
    client.react.__reset();
    const afterRendered = after.type(after.props);
    const editors = walk(afterRendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-editor"));
    assertEqual(editors.length, 0, "the escape key closes the editor");
    assertEqual(await press("d"), 1, "the discard shortcut runs");
    const discarded = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key2) => key2 });
    assertEqual(walk(discarded, (node) => String(node.props?.className ?? "").includes("dsh-sf-item")).length, 0, "the discarded card leaves the list without waiting for the storage write");
  } finally {
    client.fetchStub.restore();
  }
});

test("the copy action writes the prompt and announces it in the live region", async () => {
  const clipboard = fakeClipboard();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { clipboard });
  try {
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(registrations);
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const copy = buttonsOf(rendered).find((node) => node.props?.["aria-label"] === "actionCopy");
    assert(copy !== undefined, "the card offers the copy action");
    await copy.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assertEqual(clipboard.writes, ["Rodar o build"], "the clipboard carries the full prompt");
    const after = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const live = walk(after, (node) => node.props?.role === "status");
    assertEqual(live.length, 1, "the card carries one live region");
    assertEqual(live[0].children.join(""), "srCopied", "the live region announces the copy");
  } finally {
    client.fetchStub.restore();
  }
});

test("the clipboard fallback runs when the clipboard refuses the text", async () => {
  const clipboard = fakeClipboard({ fail: true });
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { clipboard });
  try {
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(registrations);
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const copy = buttonsOf(rendered).find((node) => node.props?.["aria-label"] === "actionCopy");
    await copy.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assertEqual(client.execCommands, ["copy"], "the fallback asks the document to copy");
  } finally {
    client.fetchStub.restore();
  }
});

test("the live region is the only element with the status role", async () => {
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } });
  try {
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(registrations);
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const live = walk(rendered, (node) => node.props?.role === "status");
    assertEqual(live.length, 1, "the card carries exactly one live region");
    assertEqual(live[0].props["aria-live"], undefined, "the live region carries no aria-live attribute");
    const withAriaLive = walk(rendered, (node) => node.props?.["aria-live"] !== undefined);
    assertEqual(withAriaLive.length, 0, "no element in the card tree carries aria-live");
  } finally {
    client.fetchStub.restore();
  }
});

test("the capture store is per session and the index is read once", async () => {
  const reads = [];
  const data = {};
  const storage = {
    getItem: (key) => {
      reads.push(key);
      return key in data ? data[key] : null;
    },
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    _data: data
  };
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    client.instance.flushWrites();
    assert(Object.keys(data).includes("dsh-nextsteps.captures.session.s1"), "the capture lands under its own session key");
    assert(!Object.keys(data).includes("dsh-nextsteps.captures.session.s2"), "a session that was never opened owns no key");
    const index = JSON.parse(data["dsh-nextsteps.captures.index"] ?? "{}");
    assert(Array.isArray(index.order), "the index carries the session order");
    assert(index.order.includes("s1"), "the index lists the session that was written");
    assertEqual(reads.filter((key) => key === "dsh-nextsteps.captures.index").length, 1, "the index is read once at boot");
    assertEqual(reads.filter((key) => key === "dsh-nextsteps.captures.session.s2").length, 0, "a session that was never opened is never read");
  } finally {
    client.fetchStub.restore();
  }
});

test("the legacy capture blob is migrated and its key is removed", async () => {
  const legacyKey = "dsh-nextsteps.captures.v1";
  const storage = memoryStorage({
    [legacyKey]: JSON.stringify({ s1: { "call-1": { turn: 3, followups: [{ prompt: "Rodar o build", label: "Rodar build" }], clickedId: "sf-old" } } })
  });
  const { client } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    assertEqual(storage._data[legacyKey], undefined, "the legacy blob is removed");
    const migrated = storage._data["dsh-nextsteps.captures.session.s1"];
    assert(migrated !== undefined, "the legacy blob lands under the per session key");
    const entry = JSON.parse(migrated)["call-1"];
    assert(entry !== undefined, "the migrated capture keeps its call id");
    assertEqual(entry.followups[0].prompt, "Rodar o build", "the migrated capture keeps its prompt");
  } finally {
    client.fetchStub.restore();
  }
});

test("the captures survive a restart", async () => {
  const storage = memoryStorage();
  const first = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    const capture = first.registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    first.client.instance.flushWrites();
    const second = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
    try {
      const tail = tailOf(second.registrations);
      const rendered = renderTail(second.client, tail, { sessionId: "s1", turn: { turn: 3, end: { seq: 9 } }, t: (key) => key });
      const cards = walk(rendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-card"));
      assertEqual(cards.length, 1, "the capture comes back after a restart");
    } finally {
      second.client.fetchStub.restore();
    }
  } finally {
    first.client.fetchStub.restore();
  }
});

test("the writes are coalesced into one write per key", async () => {
  const writes = [];
  const data = {};
  const storage = {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      writes.push(key);
      data[key] = String(value);
    },
    removeItem: (key) => { delete data[key]; },
    _data: data
  };
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    for (let index = 0; index < 5; index += 1) {
      capture.component({
        sessionId: "s1",
        callId: `call-${index}`,
        block: { kind: "tool-result", callId: `call-${index}`, name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"p","label":"l"}]}' }] }
      });
    }
    client.instance.flushWrites();
    const sessionKey = "dsh-nextsteps.captures.session.s1";
    const stored = JSON.parse(data[sessionKey]);
    assertEqual(Object.keys(stored).length, 5, "every capture reaches the store");
    const index = JSON.parse(data["dsh-nextsteps.captures.index"]);
    assert(Object.keys(index.sessions.s1).length === 5, "the index lists every capture");
    assertEqual(writes.filter((key) => key === sessionKey).length, 1, "five captures write the session key once");
    assertEqual(writes.filter((key) => key === "dsh-nextsteps.captures.index").length, 1, "five captures write the index once");
  } finally {
    client.fetchStub.restore();
  }
});

test("a failing write is retried and then dropped with one warning", async () => {
  const attemptsByKey = new Map();
  const data = {};
  const storage = {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      attemptsByKey.set(key, (attemptsByKey.get(key) ?? 0) + 1);
      throw new Error("the storage refused the write");
    },
    removeItem: (key) => { delete data[key]; },
    _data: data
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const client = loadClient({ storage, routes: { "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } } });
    try {
      const { ctx, registrations } = fakeSlotHost(client.react);
      client.instance.apply(ctx);
      const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
      capture.component({
        sessionId: "s1",
        callId: "call-1",
        block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"p","label":"l"}]}' }] }
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      client.instance.flushWrites();
      await new Promise((resolve) => setTimeout(resolve, 50));
      assertEqual(warnings.filter((line) => line.includes("the capture store could not be written")).length, 0, "no storage warning is emitted before the final drop");
      await new Promise((resolve) => setTimeout(resolve, 6000));
      const storageWarnings = warnings.filter((line) => line.includes("the capture store could not be written"));
      assert(storageWarnings.length > 0, "the dropped write warns");
      assertEqual(warnings.filter((line) => line.includes("generation failed")).length, 0, "the storage warning is not a generation warning");
      const sessionKey = "dsh-nextsteps.captures.session.s1";
      assert(attemptsByKey.has(sessionKey), `the capture write reached the storage: ${[...attemptsByKey.keys()].join(", ")}`);
      assert(attemptsByKey.size >= 1, "at least one key was written");
      for (const [key, attempts] of attemptsByKey) {
        assertEqual(attempts, 4, `the ${key} write is attempted once and retried after each delay before it is dropped`);
      }
      const warnedKeys = storageWarnings.flatMap((line) => line.split(":").slice(2).join(":").split(",").map((entry) => entry.trim())).filter((entry) => entry !== "");
      assertEqual(new Set(warnedKeys).size, attemptsByKey.size, "every dropped key is named in the warning");
      for (const key of attemptsByKey.keys()) {
        const mentions = warnedKeys.filter((entry) => entry === key).length;
        assertEqual(mentions, 1, `the dropped key ${key} is warned about exactly once, not once per attempt: ${storageWarnings.join(" | ")}`);
      }
    } finally {
      client.fetchStub.restore();
    }
  } finally {
    console.warn = originalWarn;
  }
});

test("the metrics table shows the average and the max", async () => {
  const storage = memoryStorage({ "dsh-nextsteps.metrics": JSON.stringify({ generation: [100, 300], persistence: [10], rendering: [] }) });
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    const settings = registrations.find((entry) => entry.spec?.name === "settings.section");
    assert(settings !== undefined, "the settings section is registered");
    const rendered = settings.component({ t: (key) => key });
    const text = textOf(rendered);
    assert(text.includes("metricGeneration"), `the metrics table names the stages: ${text.slice(0, 200)}`);
    assert(text.includes("200 ms"), "the metrics table shows the average");
    assert(text.includes("300 ms"), "the metrics table shows the max");
    assert(text.includes("metricNoData"), "the metrics table says when a stage has no data");
  } finally {
    client.fetchStub.restore();
  }
});

test("the on demand tail waits for the button and asks once when it is pressed", async () => {
  const settings = { ...NEW_SETTINGS, lang: "zh-CN", generationMode: "on-demand" };
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.generate": { ok: true, rev: "sf-2", followups: [{ prompt: "gerado pelo host", label: "Host" }] }
  });
  try {
    const tail = tailOf(registrations);
    await settled(client);
    const tree = tail({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const before = client.fetchStub.calls.filter((entry) => entry.url.includes(".generate"));
    assertEqual(before.length, 0, "the on demand tail never asks the host on its own");
    client.react.__setComponent(tree.type);
    client.react.__reset();
    const rendered = tree.type(tree.props);
    const generate = buttonWithText(rendered, "generateNow");
    assert(generate !== undefined, "the on demand tail offers the generate button");
    await generate.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const after = client.fetchStub.calls.filter((entry) => entry.url.includes(".generate"));
    assertEqual(after.length, 1, "the button asks the host exactly once");
    const again = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const cards = walk(again, (node) => String(node.props?.className ?? "").includes("dsh-sf-card"));
    assertEqual(cards.length, 1, "the generated card renders");
  } finally {
    client.fetchStub.restore();
  }
});

test("an aborted generation warns nothing and a conflict warns nothing", async () => {
  const settings = { ...NEW_SETTINGS, lang: "zh-CN" };
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.generate": () => new Response(JSON.stringify({ error: "the chat moved on" }), { status: 409, headers: { "content-type": "application/json" } })
  });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const tail = tailOf(registrations);
    await settled(client);
    tail({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assertEqual(warnings.filter((line) => line.includes("generation failed")).length, 0, "a conflict never warns");
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const cards = walk(rendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-card"));
    assertEqual(cards.length, 0, "a conflict renders no card");
  } finally {
    console.warn = originalWarn;
    client.fetchStub.restore();
  }
});

test("a failed generation warns exactly once across both attempts", async () => {
  const settings = { ...NEW_SETTINGS, lang: "zh-CN" };
  let calls = 0;
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.generate": () => {
      calls += 1;
      return new Response(JSON.stringify({ error: "no model" }), { status: 502, headers: { "content-type": "application/json" } });
    }
  });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const tail = tailOf(registrations);
    await settled(client);
    tail({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assertEqual(warnings.filter((line) => line.includes("generation failed")).length, 1, "the failure warns exactly once");
    assertEqual(calls, 2, "the generator was asked twice before the warning");
  } finally {
    console.warn = originalWarn;
    client.fetchStub.restore();
  }
});

test("the deferred rendering waits for the observer and falls back without one", async () => {
  const observer = fakeIntersectionObserver();
  const { client, registrations } = clientWithRoutes(
    { "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } },
    { intersectionObserver: observer.FakeIntersectionObserver }
  );
  try {
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(registrations);
    const tree = tail({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const effects = [...(client.react.__effects ?? [])];
    client.react.__setComponent(tree.type);
    client.react.__reset();
    const deferred = tree.type(tree.props);
    const cards = walk(deferred, (node) => String(node.props?.className ?? "").includes("dsh-sf-card"));
    assertEqual(cards.length, 0, "a never firing observer builds no card");
    for (const effect of effects) await effect();
    observer.fire();
    const after = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const built = walk(after, (node) => String(node.props?.className ?? "").includes("dsh-sf-card"));
    assertEqual(built.length, 1, "firing the observer builds the card");
  } finally {
    client.fetchStub.restore();
  }

  const fallback = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } });
  try {
    const capture = fallback.registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s2",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(fallback.registrations);
    const rendered = renderTail(fallback.client, tail, { sessionId: "s2", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const cards = walk(rendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-card"));
    assertEqual(cards.length, 1, "without an observer the card is built immediately");
  } finally {
    fallback.client.fetchStub.restore();
  }
});

test("the settings page sends no key the host does not read", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    const settings = registrations.find((entry) => entry.spec?.name === "settings.section");
    const rendered = settings.component({ t: (key) => key });
    const checkboxes = walk(rendered, (node) => node.type === "input" && node.props.type === "checkbox");
    assert(checkboxes.length >= 1, "the settings page offers the style checkboxes");
    const clientSource = readFileSync(path.join(root, "client.js"), "utf8");
    const hostSource = readFileSync(path.join(root, "index.js"), "utf8");
    const sent = [...new Set([...clientSource.matchAll(/save\(\{ ([a-zA-Z]+):/g)].map((match) => match[1]))];
    for (const key of sent) {
      assert(hostSource.includes(`${key}:`), `the host reads the ${key} setting`);
    }
    assert(!sent.includes("favorites"), "the favourites list is never sent as a setting");
    assert(!sent.includes("discarded"), "the discarded list is never sent as a setting");
  } finally {
    client.fetchStub.restore();
  }
});

test("the manual suggestion persists and renders in host mode", async () => {
  const storage = memoryStorage();
  const settings = { ...NEW_SETTINGS, lang: "zh-CN" };
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" } }, { storage });
  try {
    const tail = tailOf(registrations);
    let tree = tail({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    client.react.__setComponent(tree.type);
    client.react.__reset();
    let rendered = tree.type(tree.props);
    const add = buttonWithText(rendered, "addSuggestion");
    assert(add !== undefined, "the tail offers the add suggestion button");
    await add.props.onClick();
    tree = tail({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    client.react.__setComponent(tree.type);
    client.react.__reset();
    rendered = tree.type(tree.props);
    const area = walk(rendered, (node) => node.type === "textarea")[0];
    assert(area !== undefined, "the manual form opens a textarea");
    area.props.onChange({ target: { value: "minha sugestao" } });
    tree = tail({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    client.react.__setComponent(tree.type);
    client.react.__reset();
    rendered = tree.type(tree.props);
    const save = buttonWithText(rendered, "manualSave");
    assert(save !== undefined, "the manual form offers the save button");
    await save.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.instance.flushWrites();
    const stored = storage._data["dsh-nextsteps.captures.session.s1"];
    assert(stored !== undefined, "the manual suggestion reaches the store");
    const entries = Object.keys(JSON.parse(stored));
    assert(entries.some((key) => key.startsWith("manual-")), `the manual card is stored under a manual key: ${entries.join(", ")}`);

    const second = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" } }, { storage });
    try {
      const restarted = renderTail(second.client, tailOf(second.registrations), { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
      const cards = walk(restarted, (node) => String(node.props?.className ?? "").includes("dsh-sf-card"));
      assertEqual(cards.length, 1, "the manual card renders in host mode and survives a restart");
    } finally {
      second.client.fetchStub.restore();
    }
  } finally {
    client.fetchStub.restore();
  }
});

test("pruning never deletes the captures of a session it did not open", async () => {
  const entriesOf = (prefix, count) => {
    const entries = {};
    for (let index = 0; index < count; index += 1) {
      entries[`${prefix}-${index}`] = { turn: index, followups: [{ prompt: `p${index}`, label: "L" }], clickedId: `sf-${prefix}-${index}` };
    }
    return entries;
  };
  const old = entriesOf("call", 300);
  const mid = entriesOf("m", 300);
  const oldKey = "dsh-nextsteps.captures.session.old";
  const midKey = "dsh-nextsteps.captures.session.mid";
  const storage = memoryStorage({
    [oldKey]: JSON.stringify(old),
    [midKey]: JSON.stringify(mid),
    "dsh-nextsteps.captures.index": JSON.stringify({
      order: ["old", "mid"],
      sessions: {
        old: Object.fromEntries(Object.entries(old).map(([key, value]) => [key, value.turn])),
        mid: Object.fromEntries(Object.entries(mid).map(([key, value]) => [key, value.turn]))
      }
    })
  });
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "new",
      callId: "n1",
      block: { kind: "tool-result", callId: "n1", name: "suggest_followups", turn: 1, content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"x","label":"X"}]}' }] }
    });
    client.instance.flushWrites();
    const index = JSON.parse(storage._data["dsh-nextsteps.captures.index"]);
    const claimed = Object.values(index.sessions).reduce((sum, calls) => sum + Object.keys(calls ?? {}).length, 0);
    const stored = Object.keys(storage._data)
      .filter((name) => name.includes("captures.session."))
      .reduce((sum, name) => sum + Object.keys(JSON.parse(storage._data[name])).length, 0);
    assert(claimed <= 400, `the index respects the capture cap: ${claimed}`);
    assert(stored <= 400, `the store respects the capture cap: ${stored}`);
    assertEqual(stored, claimed, "the store and the index agree on how many captures exist");
    assert(storage._data[oldKey] !== undefined, "the store of an unopened session is still there");
    assert(storage._data[midKey] !== undefined, "the store of the second unopened session is still there");
  } finally {
    client.fetchStub.restore();
  }
});

test("a discarded card leaves the list before the storage write lands", async () => {
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } });
  try {
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(registrations);
    const before = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const discard = buttonsOf(before).find((node) => node.props?.["aria-label"] === "actionDiscard");
    assert(discard !== undefined, "the card offers the discard action");
    await discard.props.onClick();
    const after = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const items = walk(after, (node) => String(node.props?.className ?? "").includes("dsh-sf-item"));
    assertEqual(items.length, 0, "the discarded card leaves the list on the click's own re-render");
    const live = walk(after, (node) => node.props?.role === "status");
    assertEqual(live.length, 1, "the discard is announced through the live region");
    assertEqual(live[0].children.join(""), "srDiscarded", "the live region names the discard");
  } finally {
    client.fetchStub.restore();
  }
});

test("a favourite is reflected on the card before the storage write lands", async () => {
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } });
  try {
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(registrations);
    const before = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const favorite = buttonsOf(before).find((node) => node.props?.["aria-label"] === "actionFavorite");
    assert(favorite !== undefined, "the card offers the favourite action");
    assertEqual(favorite.children[0], "☆", "the card starts without the favourite");
    await favorite.props.onClick();
    const after = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const starred = buttonsOf(after).find((node) => node.props?.["aria-label"] === "actionFavorite");
    assertEqual(starred.children[0], "★", "the card shows the favourite on the click's own re-render");
  } finally {
    client.fetchStub.restore();
  }
});

test("two identical manual suggestions keep their own identity", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    const block = { kind: "tool-result", name: "suggest_followups", turn: 7, content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"mesma sugestao","label":"Igual"}]}' }] };
    capture.component({ sessionId: "s1", callId: "manual-7-0", block: { ...block, callId: "manual-7-0" } });
    capture.component({ sessionId: "s1", callId: "manual-7-1", block: { ...block, callId: "manual-7-1" } });
    client.instance.flushWrites();
    const stored = JSON.parse(storage._data["dsh-nextsteps.captures.session.s1"]);
    const ids = Object.values(stored).map((entry) => entry.clickedId);
    assertEqual(new Set(ids).size, ids.length, `two identical manual suggestions keep distinct identities: ${ids.join(", ")}`);
  } finally {
    client.fetchStub.restore();
  }
});

test("the inline mode honours the suggestion length", async () => {
  const settings = { ...NEW_SETTINGS, maxSuggestionChars: 60 };
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", turn: 1, content: [{ type: "text", text: JSON.stringify({ rev: "sf-2", followups: [{ prompt: "x".repeat(400), label: "L" }] }) }] }
    });
    client.instance.flushWrites();
    const stored = JSON.parse(storage._data["dsh-nextsteps.captures.session.s1"]);
    assertEqual(stored["call-1"].followups[0].prompt.length, 60, "the inline card is cut to the configured length");
  } finally {
    client.fetchStub.restore();
  }
});

test("the favourites list copies a favourite and says so", async () => {
  const clipboard = fakeClipboard();
  const storage = memoryStorage({ "dsh-nextsteps.favorites": JSON.stringify({ fav1: { prompt: "Rodar o build", label: "Build", at: 1 } }) });
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { clipboard, storage });
  try {
    const settings = registrations.find((entry) => entry.spec?.name === "settings.section");
    const rendered = settings.component({ t: (key) => key });
    const copy = buttonsOf(rendered).find((node) => node.children.includes("favoriteCopy"));
    assert(copy !== undefined, "the favourites list offers the copy button");
    await copy.props.onClick();
    assertEqual(clipboard.writes, ["Rodar o build"], "the copy button writes the favourite to the clipboard");
    const after = settings.component({ t: (key) => key });
    const notice = walk(after, (node) => String(node.props?.className ?? "") === "dsh-sf-notice");
    assertEqual(notice.length, 1, "the settings page carries the notice element");
    assert(notice[0].children.join("").includes("srCopied"), `the copy is announced: ${JSON.stringify(notice[0].children)}`);
  } finally {
    client.fetchStub.restore();
  }
});

test("the undo button is labelled", async () => {
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } });
  try {
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(registrations);
    const before = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const discard = buttonsOf(before).find((node) => node.props?.["aria-label"] === "actionDiscard");
    await discard.props.onClick();
    const after = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const undo = buttonsOf(after).find((node) => node.children.includes("undoDiscard"));
    assert(undo !== undefined, "the card offers the undo");
    assertEqual(undo.props["aria-label"], "undoDiscard", "the undo button carries an accessible name");
  } finally {
    client.fetchStub.restore();
  }
});

test("a generator that never answers is reported once", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  const settings = { ...NEW_SETTINGS, lang: "en", latencyBudgetMs: 5000 };
  let aborted = false;
  const hung = (init) => new Promise((resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      aborted = true;
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      reject(error);
    });
  });
  const client = loadClient({ routes: {
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.generate": hung
  } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail");
    tail.component({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (warnings.filter((line) => line.includes("generation failed")).length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(aborted === true, "the client's deadline aborted the hung request");
    const generationWarnings = warnings.filter((line) => line.includes("generation failed"));
    assertEqual(generationWarnings.length, 1, `a generator that never answers warns exactly once: ${generationWarnings.join(" | ")}`);
  } finally {
    console.warn = originalWarn;
    client.fetchStub.restore();
  }
});

test("a failing write is dropped even when the value keeps changing", async () => {
  const attemptsByKey = new Map();
  const data = {};
  const storage = {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      attemptsByKey.set(key, (attemptsByKey.get(key) ?? 0) + 1);
      throw new Error("the storage refused the write");
    },
    removeItem: (key) => { delete data[key]; },
    _data: data
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  const sessionKey = "dsh-nextsteps.captures.session.s1";
  try {
    const client = loadClient({ storage, routes: { "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } } });
    try {
      const { ctx, registrations } = fakeSlotHost(client.react);
      client.instance.apply(ctx);
      const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
      const dropped = () => warnings.filter((line) => line.includes("the capture store could not be written") && line.includes(sessionKey));
      for (let index = 0; index < 38; index += 1) {
        capture.component({
          sessionId: "s1",
          callId: `call-${index}`,
          block: { kind: "tool-result", callId: `call-${index}`, name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"p","label":"l"}]}' }] }
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (dropped().length > 0) break;
      }
      assert(dropped().length >= 1, `the hot key is dropped while the churn continues: ${dropped().join(" | ")}`);
      assertEqual(attemptsByKey.get(sessionKey), 4, `the hot key walks the ladder exactly once: ${attemptsByKey.get(sessionKey)} attempts`);
      const storageWarnings = warnings.filter((line) => line.includes("the capture store could not be written"));
      assertEqual(storageWarnings.filter((line) => line.includes(sessionKey)).length, dropped().length, "the key is named exactly once per drop");
      assert(storageWarnings.length >= 1, "the drop is warned");
    } finally {
      client.fetchStub.restore();
    }
  } finally {
    console.warn = originalWarn;
  }
});

test("a legacy capture blob survives a failed migration", async () => {
  const legacy = { s1: { "call-1": { turn: "3", followups: [{ prompt: "Rodar o build", label: "Build" }], clickedId: "sf-x" } } };
  const legacyKey = "dsh-nextsteps.captures.v1";
  const data = { [legacyKey]: JSON.stringify(legacy) };
  const storage = {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { throw new Error("the storage refused the write"); },
    removeItem: (key) => { delete data[key]; },
    _data: data
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const client = loadClient({ storage, routes: { "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } } });
    try {
      const { ctx } = fakeSlotHost(client.react);
      client.instance.apply(ctx);
      assert(storage._data[legacyKey] !== undefined, "the legacy blob is kept when the migration cannot write");
      assert(warnings.filter((line) => line.includes("could not be migrated")).length > 0, "the failed migration is reported");
    } finally {
      client.fetchStub.restore();
    }
  } finally {
    console.warn = originalWarn;
  }
});

test("a composer that refuses the message is reported to the user", async () => {
  const client = loadClient({ routes: { "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    ctx.get = (name) => {
      if (name === "sessions") return { binding: () => ({ id: "s1" }) };
      if (name === "conversation") return {
        input: {
          shell: () => ({
            actions: { setDraft: () => {}, submit: () => { throw new Error("the composer refused the message"); } },
            state: { getSnapshot: () => ({ draft: "Rodar o build" }) }
          })
        }
      };
      return undefined;
    };
    client.instance.apply(ctx);
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(registrations);
    const tree = tail({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    client.react.__setComponent(tree.type);
    client.react.__reset();
    const rendered = tree.type(tree.props);
    const send = walk(rendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-card"))[0];
    await send.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = tail({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    client.react.__setComponent(after.type);
    client.react.__reset();
    const afterRendered = after.type(after.props);
    const errors = walk(afterRendered, (node) => String(node.props?.className ?? "") === "dsh-sf-error");
    assert(errors.length === 1, "the failed send shows the error element");
    assert(errors[0].children.join("").includes("the composer refused the message"), `the error names the failure: ${JSON.stringify(errors[0].children)}`);
    const live = walk(afterRendered, (node) => node.props?.role === "status");
    assertEqual(live[0].children.join(""), "", "a failed send does not announce a success");
  } finally {
    client.fetchStub.restore();
  }
});

test("a legacy capture store with the wrong shape does not stop the plugin from booting", () => {
  const legacyKey = "dsh-nextsteps.captures.v1";
  for (const shape of ["[]", '"text"', "null", "42"]) {
    const storage = memoryStorage({ [legacyKey]: shape });
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(" ")); };
    try {
      const client = loadClient({ storage, routes: { "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } } });
      const { ctx, registrations } = fakeSlotHost(client.react);
      client.instance.apply(ctx);
      const names = registrations.map((entry) => entry.spec?.name ?? entry.name);
      assert(names.includes("conversation.chat.turnTail"), `the tail is registered for ${shape}`);
      assert(names.includes("settings.section"), `the settings section is registered for ${shape}`);
      assert(storage._data[legacyKey] === shape, `the legacy store is left untouched for ${shape}`);
      assert(warnings.filter((line) => line.includes("unexpected shape")).length === 1, `the wrong shape is reported for ${shape}: ${warnings.join(" | ")}`);
      client.fetchStub.restore();
    } finally {
      console.warn = originalWarn;
    }
  }
});

test("the store and the index never grow past the capture cap", async () => {
  const entriesOf = (prefix, count) => {
    const entries = {};
    for (let index = 0; index < count; index += 1) {
      entries[`${prefix}-${index}`] = { turn: index, followups: [{ prompt: `p${index}`, label: "L" }], clickedId: `sf-${prefix}-${index}` };
    }
    return entries;
  };
  const old = entriesOf("call", 300);
  const mid = entriesOf("m", 300);
  const storage = memoryStorage({
    "dsh-nextsteps.captures.session.old": JSON.stringify(old),
    "dsh-nextsteps.captures.session.mid": JSON.stringify(mid),
    "dsh-nextsteps.captures.index": JSON.stringify({
      order: ["old", "mid"],
      sessions: {
        old: Object.fromEntries(Object.entries(old).map(([key, value]) => [key, value.turn])),
        mid: Object.fromEntries(Object.entries(mid).map(([key, value]) => [key, value.turn]))
      }
    })
  });
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "new",
      callId: "n1",
      block: { kind: "tool-result", callId: "n1", name: "suggest_followups", turn: 1, content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"x","label":"X"}]}' }] }
    });
    client.instance.flushWrites();
    const index = JSON.parse(storage._data["dsh-nextsteps.captures.index"]);
    const claimed = Object.values(index.sessions).reduce((sum, calls) => sum + Object.keys(calls ?? {}).length, 0);
    const stored = Object.keys(storage._data)
      .filter((name) => name.includes("captures.session."))
      .reduce((sum, name) => sum + Object.keys(JSON.parse(storage._data[name])).length, 0);
    assert(claimed <= 400, `the index respects the capture cap: ${claimed}`);
    assert(stored <= 400, `the store respects the capture cap: ${stored}`);
    assertEqual(stored, claimed, "the store and the index agree on how many captures exist");
  } finally {
    client.fetchStub.restore();
  }
});

test("a stray tool call in the on demand mode never becomes a card", async () => {
  const settings = { ...NEW_SETTINGS, generationMode: "on-demand" };
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" } });
  try {
    await settled(client);
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Stray","label":"Stray"}]}' }] }
    });
    client.instance.flushWrites();
    const tail = tailOf(registrations);
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const items = walk(rendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-item"));
    assertEqual(items.length, 0, "the stray call produces no card");
  } finally {
    client.fetchStub.restore();
  }
});

test("the on demand generation is cancelled when the card goes away", async () => {
  const settings = { ...NEW_SETTINGS, generationMode: "on-demand", lang: "en" };
  let aborted = false;
  const hung = (init) => new Promise((resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      aborted = true;
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      reject(error);
    });
  });
  const client = loadClient({ routes: {
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.generate": hung
  } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const tail = tailOf(registrations);
    const tree = tail({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    const rendered = tree.type(tree.props);
    const generate = buttonsOf(rendered).find((node) => node.children.includes("generateNow"));
    assert(generate !== undefined, "the on demand card offers the generate button");
    generate.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(aborted === false, "the request is still running before the card goes away");
    await client.react.__cleanup();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(aborted === true, "the request is aborted when the card goes away");
  } finally {
    client.fetchStub.restore();
  }
});

test("a configuration error is not treated as a cancellation", async () => {
  const settings = { ...NEW_SETTINGS, lang: "en" };
  const client = loadClient({ routes: {
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.generate": (init) => new Response(JSON.stringify({ error: "no model is selected" }), { status: 400, headers: { "content-type": "application/json" } })
  } });
  try {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(" ")); };
    try {
      const { ctx, registrations } = fakeSlotHost(client.react);
      client.instance.apply(ctx);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail");
      tail.component({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
      for (const effect of client.react.__effects ?? []) await effect();
      await new Promise((resolve) => setTimeout(resolve, 60));
      const generationWarnings = warnings.filter((line) => line.includes("generation failed"));
      assert(generationWarnings.length > 0, "a configuration error is reported");
    } finally {
      console.warn = originalWarn;
    }
  } finally {
    client.fetchStub.restore();
  }
});

test("the copy fallback leaves no hidden field behind", async () => {
  const appended = [];
  const removed = [];
  const document = {
    head: { appendChild() {} },
    body: { appendChild(node) { appended.push(node); } },
    createElement: () => ({
      style: {},
      value: "",
      select() {},
      remove() { removed.push(true); },
      appendChild() {}
    }),
    execCommand: () => { throw new Error("the copy command was refused"); }
  };
  const clipboard = fakeClipboard({ fail: true });
  const client = loadClient({ document, clipboard, routes: { "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(registrations);
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const copy = buttonsOf(rendered).find((node) => node.props?.["aria-label"] === "actionCopy");
    await copy.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assertEqual(appended.length, 1, "the fallback adds the hidden field");
    assertEqual(removed.length, 1, "the hidden field is removed even when the copy throws");
  } finally {
    client.fetchStub.restore();
  }
});

test("a copy that fails everywhere is reported to the user", async () => {
  const clipboard = fakeClipboard({ fail: true });
  const client = loadClient({ clipboard, execCommandResult: false, routes: { "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(registrations);
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const copy = buttonsOf(rendered).find((node) => node.props?.["aria-label"] === "actionCopy");
    await copy.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const after = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const live = walk(after, (node) => node.props?.role === "status");
    assertEqual(live[0].children.join(""), "copyFailed", "the failed copy is announced");
    const notice = walk(after, (node) => String(node.props?.className ?? "") === "dsh-sf-notice");
    assertEqual(notice[0].children.join(""), "copyFailed", "the failed copy is visible");
  } finally {
    client.fetchStub.restore();
  }
});

test("the metrics record the persistence, the rendering and the generation", async () => {
  const storage = memoryStorage();
  const settings = { ...NEW_SETTINGS, lang: "en" };
  const client = loadClient({ storage, routes: {
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.generate": { ok: true, rev: "sf-2", followups: [{ prompt: "gerado", label: "Host" }] }
  } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail");
    tail.component({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const tree = tail.component({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    client.react.__setComponent(tree.type);
    client.react.__reset();
    tree.type(tree.props);
    client.instance.flushWrites();
    const metrics = JSON.parse(storage._data["dsh-nextsteps.metrics"] ?? "{}");
    assert(Array.isArray(metrics.generation) && metrics.generation.length > 0, "the generation is measured");
    assert(Array.isArray(metrics.persistence) && metrics.persistence.length > 0, "the persistence is measured");
    assert(Array.isArray(metrics.rendering) && metrics.rendering.length > 0, "the rendering is measured");
    for (const stage of ["generation", "persistence", "rendering"]) {
      assert(metrics[stage].length <= 50, `the ${stage} samples stay bounded: ${metrics[stage].length}`);
    }
  } finally {
    client.fetchStub.restore();
  }
});

test("the client clamps the latency budget when the settings do not carry one", async () => {
  const armDeadline = async (settings) => {
    const client = loadClient({ routes: { "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" } } });
    try {
      const { ctx, registrations } = fakeSlotHost(client.react);
      client.instance.apply(ctx);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const timeouts = [];
      const originalSetTimeout = client.window.setTimeout;
      client.window.setTimeout = (fn, ms) => { timeouts.push(ms); return originalSetTimeout(fn, ms); };
      const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail");
      tail.component({ sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
      for (const effect of client.react.__effects ?? []) await effect();
      await new Promise((resolve) => setTimeout(resolve, 60));
      return timeouts;
    } finally {
      client.fetchStub.restore();
    }
  };
  const missing = await armDeadline({ lang: "en", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", maxSuggestionChars: 200 });
  assert(missing.includes(35000), `the missing budget arms the default deadline: ${JSON.stringify(missing)}`);
  const seven = await armDeadline({ ...NEW_SETTINGS, lang: "en", latencyBudgetMs: 7000 });
  assert(seven.includes(12000), `the seven second budget arms twelve seconds: ${JSON.stringify(seven)}`);
  const junk = await armDeadline({ ...NEW_SETTINGS, lang: "en", latencyBudgetMs: "not a number" });
  assert(junk.includes(35000), `a non-numeric budget arms the default deadline: ${JSON.stringify(junk)}`);
  assert(junk.every((ms) => Number.isFinite(ms)), `every armed deadline is finite: ${JSON.stringify(junk)}`);
  const tiny = await armDeadline({ ...NEW_SETTINGS, lang: "en", latencyBudgetMs: 1 });
  assert(tiny.includes(10000), `a budget below the floor is clamped: ${JSON.stringify(tiny)}`);
});

test("the discarded list in the settings page lists and restores the prompt", async () => {
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } });
  try {
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Rodar o build","label":"Rodar build"}]}' }] }
    });
    const tail = tailOf(registrations);
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const discard = buttonsOf(rendered).find((node) => node.props?.["aria-label"] === "actionDiscard");
    await discard.props.onClick();
    client.instance.flushWrites();
    await settled(client);
    const section = registrations.find((entry) => entry.spec?.name === "settings.section");
    const settingsTree = section.component({ t: (key) => key });
    const text = textOf(settingsTree);
    assert(text.includes("Rodar o build"), `the discarded prompt is listed: ${text.slice(0, 200)}`);
    const restore = buttonsOf(settingsTree).find((node) => node.children.includes("discardRestore"));
    assert(restore !== undefined, "the discarded list offers the restore button");
    restore.props.onClick();
    client.instance.flushWrites();
    const discarded = JSON.parse(client.storage._data["dsh-nextsteps.discarded"] ?? "{}");
    assertEqual(Object.keys(discarded).length, 0, "the restore empties the discarded store");
  } finally {
    client.fetchStub.restore();
  }
});

test("two manual suggestions in the same turn keep their own identity", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    const tail = tailOf(registrations);
    const open = async (text) => {
      const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
      const add = buttonsOf(rendered).find((node) => node.children.includes("addSuggestion"));
      await add.props.onClick();
      const withForm = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
      const area = walk(withForm, (node) => node.type === "textarea")[0];
      area.props.onChange({ target: { value: text } });
      const withText = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
      const save = buttonsOf(withText).find((node) => node.children.includes("manualSave"));
      await save.props.onClick();
    };
    await open("primeira sugestao");
    await open("segunda sugestao");
    client.instance.flushWrites();
    const stored = JSON.parse(storage._data["dsh-nextsteps.captures.session.s1"] ?? "{}");
    const keys = Object.keys(stored).filter((key) => key.startsWith("manual-"));
    assertEqual(keys.length, 2, `two manual suggestions are stored: ${keys.join(", ")}`);
    assert(keys[0] !== keys[1], "the two manual suggestions carry different keys");
    const ids = keys.map((key) => stored[key].clickedId);
    assertEqual(new Set(ids).size, 2, `the two manual suggestions carry different identities: ${ids.join(", ")}`);
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, t: (key) => key });
    const items = walk(rendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-item"));
    assertEqual(items.length, 2, "both manual suggestions render as cards");
  } finally {
    client.fetchStub.restore();
  }
});
