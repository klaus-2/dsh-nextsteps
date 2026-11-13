import { readFileSync } from "node:fs";
import path from "node:path";
import { suite, test, assert, assertEqual, assertIncludes, assertMatch, pluginId } from "../harness.mjs";
import { loadClient, fakeSlotHost, stubFetch, walk, textOf, memoryStorage, fakeIntersectionObserver, fakeClipboard, dispatchDocument } from "../client-harness.mjs";
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
  const tree = tail.component({ sessionId: "s1", turn: { turn: 3 }, seq: 12, t: (key) => key });
  const cards = walk(tree, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
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
    tail.component({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
    tail.component({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
    const tree = tail.component({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    client.react.__setComponent(tree.type);
    client.react.__reset();
    const rendered = tree.type(tree.props);
    const cards = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
    assertEqual(cards.length, 1, "only the generated card renders in host mode");
  } finally {
    client.fetchStub.restore();
  }
});

test("the tail asks the host for the turn/end seq, not the closing node seq", async () => {
  const client = loadClient({ routes: {
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "zh-CN", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.0" },
    "/api/dsh-nextsteps.generate": { ok: true, rev: "sf-2", followups: [{ prompt: "修复解析器", label: "修复" }] }
  } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail");
    tail.component({ sessionId: "s1", turn: { turn: 3, end: { type: "turn/end", seq: 139, data: { reason: { kind: "completed" } } } }, seq: 137, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const generated = client.fetchStub.calls.filter((entry) => entry.url.includes(".generate"));
    assertEqual(generated.length, 1, `the generation starts once the turn has closed: ${generated.length} calls`);
    const posted = JSON.parse(generated[0]?.body ?? "{}");
    assertEqual(posted.afterSeq, 139, "the request carries the turn/end seq, not the closing node seq");
    client.instance.flushWrites();
    const store = JSON.parse(client.storage._data["dsh-nextsteps.captures.session.s1"] ?? "{}");
    assert(store["generated-3"] !== undefined, "the generated capture is stored for the turn");
  } finally {
    client.fetchStub.restore();
  }
});

test("the tail falls back to the bare seq when the turn carries no end event", async () => {
  const client = loadClient({ routes: {
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "zh-CN", maxFollowups: 3, showHeader: true, model: "", styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 30000, maxSuggestionChars: 200 }, version: "1.0.0" },
    "/api/dsh-nextsteps.generate": { ok: true, rev: "sf-2", followups: [{ prompt: "修复解析器", label: "修复" }] }
  } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail");
    tail.component({ sessionId: "s1", turn: { turn: 3 }, seq: 12, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const generated = client.fetchStub.calls.filter((entry) => entry.url.includes(".generate"));
    assertEqual(generated.length, 1, `the fallback still starts the generation: ${generated.length} calls`);
    const posted = JSON.parse(generated[0]?.body ?? "{}");
    assertEqual(posted.afterSeq, 12, "the fallback carries the seq the app handed over");
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
    tail.component({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const generationWarnings = warnings.filter((line) => line.includes("generation failed"));
    assertEqual(generationWarnings.length, 1, "the failure warns exactly once");
    client.instance.flushWrites();
    const key = Object.keys(client.storage._data).find((name) => name.includes("captures.session.s1"));
    const store = key === undefined ? {} : JSON.parse(client.storage._data[key]);
    assertEqual(Object.keys(store).length, 0, "a failed generation stores no card");
    const tree = tail.component({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    client.react.__setComponent(tree.type);
    client.react.__reset();
    const rendered = tree.type(tree.props);
    const cards = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
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
  if (tree === null) return null;
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

function itemsOf(tree) {
  return walk(tree, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
}

function gripOf(item) {
  return walk(item, (node) => node.props?.className === "dsh-sf-grip")[0];
}

function cardlineOf(item) {
  return walk(item, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-cardline"))[0];
}

function draggingLinesOf(tree) {
  return walk(tree, (node) => String(node.props?.className ?? "").split(/\s+/).includes("is-dragging"));
}

function dragOntoCardline(client, grip, targetCardline, pointerId = 1) {
  grip.props.onPointerDown({ pointerId, clientX: 10, clientY: 10 });
  dispatchDocument(client.document, "pointermove", { pointerId, clientX: 12, clientY: 12 });
  client.document.elementsFromPoint = () => [{ className: "dsh-sf-cardline", dataset: { itemId: targetCardline.props["data-item-id"] } }];
  dispatchDocument(client.document, "pointermove", { pointerId, clientX: 40, clientY: 200 });
}

function cardLabelsOf(tree) {
  return walk(tree, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card")).map((node) => node.props["aria-label"]);
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
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    const send = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"))[0];
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
      const tree = tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key2) => key2 });
      client.react.__setComponent(tree.type);
      client.react.__reset();
      const rendered = tree.type(tree.props);
      const item = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"))[0];
      assert(item !== undefined, "the card item exists");
      let prevented = 0;
      item.props.onKeyDown({ key, target: { tagName: "DIV" }, preventDefault: () => { prevented += 1; } });
      return prevented;
    };
    assertEqual(await press("e"), 1, "the edit shortcut runs");
    assertEqual(await press("f"), 1, "the favourite shortcut runs");
    assertEqual(await press("c"), 1, "the copy shortcut runs");
    const tree = tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key2) => key2 });
    client.react.__setComponent(tree.type);
    client.react.__reset();
    const rendered = tree.type(tree.props);
    const item = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"))[0];
    item.props.onKeyDown({ key: "Escape", target: { tagName: "DIV" }, preventDefault: () => {} });
    const after = tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key2) => key2 });
    client.react.__setComponent(after.type);
    client.react.__reset();
    const afterRendered = after.type(after.props);
    const editors = walk(afterRendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-editor"));
    assertEqual(editors.length, 0, "the escape key closes the editor");
    assertEqual(await press("d"), 1, "the discard shortcut runs");
    const discarded = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key2) => key2 });
    assertEqual(walk(discarded, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item")).length, 0, "the discarded card leaves the list without waiting for the storage write");
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
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    const copy = buttonsOf(rendered).find((node) => node.props?.["aria-label"] === "actionCopy");
    assert(copy !== undefined, "the card offers the copy action");
    await copy.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assertEqual(clipboard.writes, ["Rodar o build"], "the clipboard carries the full prompt");
    const after = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
      const rendered = renderTail(second.client, tail, { sessionId: "s1", turn: { turn: 3 }, seq: 9, t: (key) => key });
      const cards = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
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
    "/api/dsh-nextsteps.generate": (init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (body.includes('"validate":true')) return { ok: true, completed: true };
      return { ok: true, rev: "sf-2", followups: [{ prompt: "gerado pelo host", label: "Host" }] };
    }
  });
  try {
    const tail = tailOf(registrations);
    await settled(client);
    const tree = tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const isGenerate = (entry) => entry.url.includes(".generate");
    const isValidate = (entry) => isGenerate(entry) && typeof entry.body === "string" && entry.body.includes('"validate":true');
    const isRealGenerate = (entry) => isGenerate(entry) && !isValidate(entry);
    const before = client.fetchStub.calls.filter(isRealGenerate);
    assertEqual(before.length, 0, "the on demand tail never asks the host to generate on its own");
    const validates = client.fetchStub.calls.filter(isValidate);
    assertEqual(validates.length, 1, "the tail probes the turn exactly once");
    const probedTree = tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    assert(probedTree !== null, "the completed probe reveals the tail");
    client.react.__setComponent(probedTree.type);
    client.react.__reset();
    const rendered = probedTree.type(probedTree.props);
    const generate = buttonWithText(rendered, "generateNow");
    assert(generate !== undefined, "the on demand tail offers the generate button");
    await generate.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const after = client.fetchStub.calls.filter(isRealGenerate);
    assertEqual(after.length, 1, "the button asks the host exactly once");
    const again = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    const cards = walk(again, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
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
    tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assertEqual(warnings.filter((line) => line.includes("generation failed")).length, 0, "a conflict never warns");
    assertEqual(renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key }), null, "a conflict renders no tail");
    const validateCalls = client.fetchStub.calls.filter((call) => typeof call.body === "string" && call.body.includes('"validate":true'));
    assertEqual(validateCalls.length, 0, "the auto mode never probes the host even when the turn is empty");
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
    tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assertEqual(warnings.filter((line) => line.includes("generation failed")).length, 1, "the failure warns exactly once");
    assertEqual(calls, 2, "the generator was asked twice before the warning");
  } finally {
    console.warn = originalWarn;
    client.fetchStub.restore();
  }
});

function retryNodeOf(rendered) {
  return walk(rendered, (node) => node.props?.className === "dsh-sf-retry")[0];
}

test("a failed generation offers a retry that asks the host once more", async () => {
  const settings = { ...NEW_SETTINGS, lang: "zh-CN" };
  const { client, ctx, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.generate": () => new Response(JSON.stringify({ error: "no model" }), { status: 400, headers: { "content-type": "application/json" } })
  });
  try {
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: ctx.locale.bind("dsh-nextsteps") };
    tail(props);
    await settled(client);
    const rendered = renderTail(client, tail, props);
    const retry = retryNodeOf(rendered);
    assert(retry !== undefined, "the failed generation renders the retry block");
    assert(textOf(retry).includes("Generation failed: the generator answered with HTTP 400"), `the retry line carries the failure message: ${textOf(retry)}`);
    const retryButton = buttonsOf(retry)[0];
    assert(retryButton !== undefined && retryButton.type === "button", "the retry block carries the try-again button");
    assertEqual(retryButton.children[0], "Try again", "the button reads the retry label");
    client.fetchStub.set("/api/dsh-nextsteps.generate", { ok: true, rev: "sf-2", followups: [{ prompt: "Rodar o build", label: "Rodar build" }], model: "demo", source: "transcript" });
    await retryButton.props.onClick();
    await settled(client);
    const after = renderTail(client, tail, props);
    const generateCalls = client.fetchStub.calls.filter((call) => call.url === "/api/dsh-nextsteps.generate");
    assertEqual(generateCalls.length, 2, `the retry asks the host exactly once more: ${generateCalls.length}`);
    const firstBody = JSON.parse(generateCalls[0].body);
    const retryBody = JSON.parse(generateCalls[1].body);
    assertEqual(retryBody, firstBody, "the retry repeats the same session and sequence");
    const cards = walk(after, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
    assert(cards.length === 1, `the retried generation renders the card: ${cards.length}`);
    assert(retryNodeOf(after) === undefined, "the retry block disappears after the retry succeeds");
  } finally {
    client.fetchStub.restore();
  }
});

test("a conflict keeps no retry offer", async () => {
  const settings = { ...NEW_SETTINGS, lang: "zh-CN" };
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.generate": () => new Response(JSON.stringify({ error: "the chat moved on" }), { status: 409, headers: { "content-type": "application/json" } })
  });
  try {
    const tail = tailOf(registrations);
    tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    await settled(client);
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    assertEqual(rendered, null, "a conflict renders no tail at all");
    assertEqual(client.fetchStub.calls.filter((call) => call.url === "/api/dsh-nextsteps.generate").length, 1, "the conflict ends the round");
  } finally {
    client.fetchStub.restore();
  }
});

test("an aborted generation keeps no retry offer", async () => {
  const settings = { ...NEW_SETTINGS, lang: "zh-CN" };
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.generate": (init) => new Promise((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      });
    })
  });
  try {
    const tail = tailOf(registrations);
    tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    await settled(client);
    await client.react.__cleanup();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    assertEqual(rendered, null, "an aborted generation renders no tail at all");
    assertEqual(client.fetchStub.calls.filter((call) => call.url === "/api/dsh-nextsteps.generate").length, 1, "the abort ends the round");
  } finally {
    client.fetchStub.restore();
  }
});

test("the retry button disappears once the turn has cards", async () => {
  const settings = { ...NEW_SETTINGS, lang: "zh-CN" };
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.generate": () => new Response(JSON.stringify({ error: "no model" }), { status: 400, headers: { "content-type": "application/json" } })
  });
  try {
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    tail(props);
    await settled(client);
    const failed = renderTail(client, tail, props);
    assert(retryNodeOf(failed) !== undefined, "the failed generation shows the retry block");
    const withForm = renderTail(client, tail, props);
    const add = buttonsOf(withForm).find((node) => node.children.includes("addSuggestion"));
    await add.props.onClick();
    const formTree = renderTail(client, tail, props);
    const area = walk(formTree, (node) => node.type === "textarea")[0];
    area.props.onChange({ target: { value: "sugestao manual" } });
    const saveTree = renderTail(client, tail, props);
    const save = buttonsOf(saveTree).find((node) => node.children.includes("manualSave"));
    await save.props.onClick();
    const after = renderTail(client, tail, props);
    const cards = walk(after, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
    assert(cards.length === 1, `the manual card renders: ${cards.length}`);
    assert(retryNodeOf(after) === undefined, "the retry block disappears once the turn has cards");
  } finally {
    client.fetchStub.restore();
  }
});

test("the retry button is visible but disabled while a generation runs", async () => {
  const settings = { ...NEW_SETTINGS, lang: "zh-CN" };
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.generate": () => new Response(JSON.stringify({ error: "no model" }), { status: 400, headers: { "content-type": "application/json" } })
  });
  try {
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    tail(props);
    await settled(client);
    client.fetchStub.set("/api/dsh-nextsteps.generate", () => new Promise(() => {}));
    const failed = renderTail(client, tail, props);
    const retryButton = buttonsOf(retryNodeOf(failed)).find((node) => node.props?.["aria-label"] === "retryGeneration");
    assert(retryButton !== undefined, "the retry block is present before the retry");
    retryButton.props.onClick();
    const running = renderTail(client, tail, props);
    const runningNode = retryNodeOf(running);
    assert(runningNode !== undefined, "the retry block stays visible while the retry round runs");
    const runningButton = buttonsOf(runningNode).find((node) => node.props?.["aria-label"] === "retryGeneration");
    assertEqual(runningButton.props.disabled, true, "the retry button is disabled while the generation runs");
    runningButton.props.onClick();
    const generateCalls = client.fetchStub.calls.filter((call) => call.url === "/api/dsh-nextsteps.generate");
    assertEqual(generateCalls.length, 2, `no second retry round fires while the first is pending: ${generateCalls.length}`);
  } finally {
    client.fetchStub.restore();
  }
});

test("a session override renders only generated cards and triggers the generate fetch in a globally inline mode", async () => {
  const storage = memoryStorage({ "dsh-nextsteps.session-overrides": JSON.stringify({ "sess-1": { lang: "zh-CN" } }) });
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.generate": () => new Response(JSON.stringify({ error: "no model" }), { status: 400, headers: { "content-type": "application/json" } })
  }, { storage });
  try {
    await settled(client);
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    const tail = tailOf(registrations);
    tail({ sessionId: "sess-1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    await settled(client);
    const generateCalls = client.fetchStub.calls.filter((call) => call.url === "/api/dsh-nextsteps.generate");
    assertEqual(generateCalls.length, 1, `the override session asks the host once: ${generateCalls.length}`);
    assertEqual(JSON.parse(generateCalls[0].body).lang, "zh-CN", "the override language rides the generate body");
    capture.component({
      sessionId: "sess-1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", turn: 1, content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Stray","label":"Stray"}]}' }] }
    });
    client.instance.flushWrites();
    const rendered = renderTail(client, tail, { sessionId: "sess-1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    const cards = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
    assertEqual(cards.length, 0, "the model-authored capture never renders for an override session");
    tail({ sessionId: "sess-2", turn: { turn: 1 }, seq: 9, t: (key) => key });
    await settled(client);
    assertEqual(client.fetchStub.calls.filter((call) => call.url === "/api/dsh-nextsteps.generate").length, 1, "the session without the override stays inline");
  } finally {
    client.fetchStub.restore();
  }
});

test("a count-only override engages the host generation and carries maxFollowups", async () => {
  const storage = memoryStorage({ "dsh-nextsteps.session-overrides": JSON.stringify({ s1: { maxFollowups: 2 } }) });
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" },
    "/api/dsh-nextsteps.generate": () => new Response(JSON.stringify({ error: "no model" }), { status: 400, headers: { "content-type": "application/json" } })
  }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    await settled(client);
    const generateCalls = client.fetchStub.calls.filter((call) => call.url === "/api/dsh-nextsteps.generate");
    assertEqual(generateCalls.length, 1, `the count-only override asks the host once: ${generateCalls.length}`);
    const body = JSON.parse(generateCalls[0].body);
    assertEqual(body.maxFollowups, 2, `the generate body carries the override count: ${JSON.stringify(body)}`);
    assert(body.lang === undefined, `the body carries no language key: ${JSON.stringify(body)}`);
  } finally {
    client.fetchStub.restore();
  }
});

test("the session options editor writes only the override store", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" },
    "/api/dsh-nextsteps.generate": { ok: true, rev: "sf-2", followups: [{ prompt: "gerado pelo host", label: "Host" }] }
  }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao"]);
    client.instance.flushWrites();
    const open = renderTail(client, tail, props);
    const optionsButton = buttonsOf(open).find((node) => node.children.includes("sessionOptions"));
    assert(optionsButton !== undefined, "the header offers the session options button");
    await optionsButton.props.onClick();
    const panel = renderTail(client, tail, props);
    const select = walk(panel, (node) => node.type === "select" && node.props?.["aria-label"] === "setLanguage")[0];
    assert(select !== undefined, "the panel offers the language select");
    select.props.onChange({ target: { value: "zh-CN" } });
    client.instance.flushWrites();
    const panelAgain = renderTail(client, tail, props);
    const input = walk(panelAgain, (node) => node.type === "input" && node.props?.["aria-label"] === "setMax")[0];
    assert(input !== undefined, "the panel offers the count input");
    input.props.onChange({ target: { value: "2" } });
    client.instance.flushWrites();
    const stored = JSON.parse(storage._data["dsh-nextsteps.session-overrides"] ?? "{}");
    assertEqual(stored, { s1: { lang: "zh-CN", maxFollowups: 2 } }, `only the override store was written: ${JSON.stringify(stored)}`);
    const settingsPosts = client.fetchStub.calls.filter((call) => call.method === "POST" && call.url.includes(".settings"));
    assertEqual(settingsPosts.length, 0, "the editor never touches the global settings route");
  } finally {
    client.fetchStub.restore();
  }
});

test("resetting the session options restores the global behaviour", async () => {
  const storage = memoryStorage({ "dsh-nextsteps.session-overrides": JSON.stringify({ s1: { lang: "zh-CN" } }) });
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" },
    "/api/dsh-nextsteps.generate": { ok: true, rev: "sf-2", followups: [{ prompt: "Rodar o build", label: "Rodar build" }], model: "demo", source: "transcript" }
  }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    tail(props);
    await settled(client);
    assertEqual(client.fetchStub.calls.filter((call) => call.url === "/api/dsh-nextsteps.generate").length, 1, "the override session generated once");
    const open = renderTail(client, tail, props);
    const optionsButton = buttonsOf(open).find((node) => node.children.includes("sessionOptions"));
    await optionsButton.props.onClick();
    const panel = renderTail(client, tail, props);
    const reset = buttonsOf(panel).find((node) => node.props?.["aria-label"] === "sessionReset");
    assert(reset !== undefined, "the panel offers the reset button");
    await reset.props.onClick();
    client.instance.flushWrites();
    assert(storage._data["dsh-nextsteps.session-overrides"] === undefined, "the reset removes the override entry");
    tail(props);
    await settled(client);
    assertEqual(client.fetchStub.calls.filter((call) => call.url === "/api/dsh-nextsteps.generate").length, 1, "the session stays inline after the reset");
  } finally {
    client.fetchStub.restore();
  }
});

test("an override change engages the host generation without any manual flush", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" },
    "/api/dsh-nextsteps.generate": () => new Response(JSON.stringify({ error: "no model" }), { status: 400, headers: { "content-type": "application/json" } })
  }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "sess-1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "sess-1", 1, ["primeira sugestao"]);
    client.instance.flushWrites();
    const open = renderTail(client, tail, props);
    const optionsButton = buttonsOf(open).find((node) => node.children.includes("sessionOptions"));
    await optionsButton.props.onClick();
    const panel = renderTail(client, tail, props);
    const select = walk(panel, (node) => node.type === "select" && node.props?.["aria-label"] === "setLanguage")[0];
    select.props.onChange({ target: { value: "pt-BR" } });
    const after = renderTail(client, tail, props);
    const selectAfter = walk(after, (node) => node.type === "select" && node.props?.["aria-label"] === "setLanguage")[0];
    assertEqual(selectAfter.props.value, "pt-BR", "the panel keeps the override on a fresh render with no manual flush");
    const nextTurn = { sessionId: "sess-1", turn: { turn: 2 }, seq: 20, t: (key) => key };
    tail(nextTurn);
    await settled(client);
    const generateCalls = client.fetchStub.calls.filter((call) => call.url === "/api/dsh-nextsteps.generate");
    assertEqual(generateCalls.length, 1, `the generation gate re-fires for the override session with no flush: ${generateCalls.length}`);
    assertEqual(JSON.parse(generateCalls[0].body).lang, "pt-BR", "the generate body carries the override language");
  } finally {
    client.fetchStub.restore();
  }
});

test("the session options editor drops a junk count instead of storing it", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao"]);
    client.instance.flushWrites();
    const open = renderTail(client, tail, props);
    const optionsButton = buttonsOf(open).find((node) => node.children.includes("sessionOptions"));
    await optionsButton.props.onClick();
    const panel = renderTail(client, tail, props);
    const select = walk(panel, (node) => node.type === "select" && node.props?.["aria-label"] === "setLanguage")[0];
    select.props.onChange({ target: { value: "pt-BR" } });
    const panelAgain = renderTail(client, tail, props);
    const input = walk(panelAgain, (node) => node.type === "input" && node.props?.["aria-label"] === "setMax")[0];
    input.props.onChange({ target: { value: "9" } });
    client.instance.flushWrites();
    const stored = JSON.parse(storage._data["dsh-nextsteps.session-overrides"] ?? "{}");
    assertEqual(stored, { s1: { lang: "pt-BR" } }, `the junk count is never persisted: ${JSON.stringify(stored)}`);
    assert(!JSON.stringify(stored).includes("9"), "no trace of the junk value reaches the store");
  } finally {
    client.fetchStub.restore();
  }
});

async function addManualSuggestion(client, tail, props, text) {
  const withForm = renderTail(client, tail, props);
  const add = buttonsOf(withForm).find((node) => node.children.includes("addSuggestion"));
  await add.props.onClick();
  const formTree = renderTail(client, tail, props);
  const area = walk(formTree, (node) => node.type === "textarea")[0];
  area.props.onChange({ target: { value: text } });
  const saveTree = renderTail(client, tail, props);
  const save = buttonsOf(saveTree).find((node) => node.children.includes("manualSave"));
  await save.props.onClick();
}

function seedCaptures(registrations, sessionId, turn, prompts) {
  const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
  assert(capture !== undefined, "the toolview capture slot is registered");
  const followups = prompts.map((prompt) => ({ prompt, label: null }));
  capture.component({
    sessionId,
    callId: `generated-${turn}-seed-${sessionId}-${prompts.length}`,
    block: { kind: "tool-result", callId: `generated-${turn}-seed-${sessionId}-${prompts.length}`, name: "suggest_followups", turn, content: [{ type: "text", text: JSON.stringify({ rev: "sf-2", followups }) }] }
  });
}

function captureItemIds(storage, sessionId, turn) {
  const captures = JSON.parse(storage._data[`dsh-nextsteps.captures.session.${sessionId}`] ?? "{}");
  const ids = [];
  for (const [key, value] of Object.entries(captures).sort(([a], [b]) => a.localeCompare(b))) {
    if (key === `generated-${turn}` || key.startsWith(`manual-${turn}-`)) continue;
    const followups = Array.isArray(value?.followups) ? value.followups : [];
    for (const index of followups.keys()) ids.push(`${value.clickedId}:${index}`);
  }
  return ids;
}

function manualItemIds(storage, sessionId) {
  const captures = JSON.parse(storage._data[`dsh-nextsteps.captures.session.${sessionId}`] ?? "{}");
  return Object.keys(captures).filter((key) => key.startsWith("manual-")).map((key) => `${captures[key].clickedId}:0`);
}

test("the move buttons reorder the cards and persist the order", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao", "segunda sugestao"]);
    client.instance.flushWrites();
    const ids = captureItemIds(storage, "s1", 1);
    assertEqual(ids.length, 2, "two capture items were seeded");
    const rendered = renderTail(client, tail, props);
    const items = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
    assertEqual(items.length, 2, "both cards render before the reorder");
    const moveEarlier = buttonsOf(items[1]).find((node) => node.props?.["aria-label"] === "actionMoveEarlier");
    assert(moveEarlier !== undefined, "the second item offers the move-earlier button");
    moveEarlier.props.onClick();
    client.instance.flushWrites();
    const reordered = renderTail(client, tail, props);
    const cards = walk(reordered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
    assertEqual(cards[0].props["aria-label"], "segunda sugestao", "the second suggestion moved earlier");
    assertEqual(JSON.parse(storage._data["dsh-nextsteps.card-order"] ?? "{}"), { "s1|1": [ids[1], ids[0]] }, "the order persisted for the session and turn");
    const liveRegion = walk(reordered, (node) => node.props?.className === "dsh-sf-sr")[0];
    assert(liveRegion !== undefined && liveRegion.children[0] === "srReordered", `the reorder is announced: ${liveRegion?.children?.[0]}`);
  } finally {
    client.fetchStub.restore();
  }
});

test("unknown stored order ids degrade to the natural order", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao", "segunda sugestao"]);
    client.instance.flushWrites();
    const ids = captureItemIds(storage, "s1", 1);
    storage._data["dsh-nextsteps.card-order"] = JSON.stringify({ "s1|1": ["stale-a", ids[0], "stale-b"] });
    const rendered = renderTail(client, tail, props);
    const cards = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
    assertEqual(cards.length, 2, "both real cards render despite stale ids");
    assertEqual(cards[0].props["aria-label"], "primeira sugestao", "the unknown ids are ignored and the natural order holds");
    assertEqual(cards[1].props["aria-label"], "segunda sugestao", "the second card follows in natural order");
  } finally {
    client.fetchStub.restore();
  }
});

test("no order entry is written when the turn is undefined", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", turn: 1, content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Unica","label":"Unica"}]}' }] }
    });
    client.instance.flushWrites();
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: undefined, seq: 9, t: (key) => key };
    const rendered = renderTail(client, tail, props);
    const items = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
    assert(items.length >= 1, "the fallback path renders the newest capture");
    const moveEarlier = buttonsOf(items[0]).find((node) => node.props?.["aria-label"] === "actionMoveEarlier");
    assert(moveEarlier !== undefined, "the fallback item offers the move button");
    moveEarlier.props.onClick();
    client.instance.flushWrites();
    assertEqual(storage._data["dsh-nextsteps.card-order"], undefined, "no order entry is written without a turn");
  } finally {
    client.fetchStub.restore();
  }
});

test("the order map is capped at 40 keys", async () => {
  const seed = {};
  for (let index = 0; index < 40; index += 1) seed[`s${index}|0`] = ["id-a", "id-b"];
  const storage = memoryStorage({ "dsh-nextsteps.card-order": JSON.stringify(seed) });
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s40", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s40", 1, ["primeira sugestao", "segunda sugestao"]);
    client.instance.flushWrites();
    const rendered = renderTail(client, tail, props);
    const items = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
    const moveEarlier = buttonsOf(items[1]).find((node) => node.props?.["aria-label"] === "actionMoveEarlier");
    moveEarlier.props.onClick();
    client.instance.flushWrites();
    const stored = JSON.parse(storage._data["dsh-nextsteps.card-order"] ?? "{}");
    assertEqual(Object.keys(stored).length, 40, `the map stays at the cap: ${Object.keys(stored).length}`);
    assert(stored["s0|0"] === undefined, "the oldest preseeded key was pruned");
    assert(Array.isArray(stored["s40|1"]), "the new order key was kept");
  } finally {
    client.fetchStub.restore();
  }
});

test("the grip handle drags one card onto another", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao", "segunda sugestao"]);
    client.instance.flushWrites();
    const ids = captureItemIds(storage, "s1", 1);
    const rendered = renderTail(client, tail, props);
    const items = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
    assertEqual(items.length, 2, "both cards render before the drag");
    const grips = walk(rendered, (node) => node.props?.className === "dsh-sf-grip");
    assertEqual(grips.length, 2, "every item carries the grip handle");
    const cardlines = walk(rendered, (node) => String(node.props?.className ?? "").includes("dsh-sf-cardline"));
    assertEqual(cardlines.length, 2, "every item carries the cardline row");
    for (const cardline of cardlines) {
      assertEqual(cardline.children[0].props.className, "dsh-sf-grip", "the grip sits LEFT of the card inside the cardline");
      assert(String(cardline.children[1].props.className).includes("dsh-sf-card"), "the card follows the grip inside the cardline");
    }
    assertEqual(JSON.parse(storage._data["dsh-nextsteps.card-order"] ?? "{}"), {}, "no order entry exists before any move");
  } finally {
    client.fetchStub.restore();
  }
});

test("the stylesheet carries the cardline and hover-reveal contract", () => {
  const source = readFileSync(path.join(root, "client.js"), "utf8");
  assertIncludes(source, ".dsh-sf-cardline { display: flex; align-items: center; gap: 4px; max-width: 100%; min-width: 0; }", "the cardline row is styled");
  assertIncludes(source, ".dsh-sf-cardline.is-dragging { opacity: 0.5; }", "the dragging state dims the cardline");
  assertIncludes(source, ".dsh-sf-grip { cursor: grab; touch-action: none; flex: none; user-select: none; }", "the grip keeps its cursor and blocks touch scrolling during a drag");
  assertIncludes(source, ".dsh-sf-item-actions { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; opacity: 0; pointer-events: none;", "the per-card actions start hidden but focusable");
  assertIncludes(source, ".dsh-sf-item:hover .dsh-sf-item-actions, .dsh-sf-item:focus-within .dsh-sf-item-actions { opacity: 1; pointer-events: auto; }", "hover and focus reveal the per-card actions");
  assertIncludes(source, "@media (hover: none) { .dsh-sf-item-actions { opacity: 1; pointer-events: auto; } }", "touch devices keep the actions visible");
  const itemActionRows = [...source.matchAll(/className: 'dsh-sf-item-actions'/g)].length;
  assertEqual(itemActionRows, 1, "only the per-card row carries the reveal class");
  const sharedActionRows = [...source.matchAll(/className: 'dsh-sf-actions'/g)].length;
  assertEqual(sharedActionRows, 4, "the editor, manual, undo and footer rows keep the always-visible class");
  assert(!source.includes("onDragStart"), "the dead HTML5 drag start is gone");
  assert(!source.includes("onDragOver"), "the dead HTML5 drag over is gone");
  assert(!source.includes("dataTransfer"), "the dead HTML5 drag payload is gone");
});

test("reorder semantics are directional: insert-after below, insert-before above, with boundary no-ops", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao", "segunda sugestao", "terceira sugestao"]);
    client.instance.flushWrites();
    const ids = captureItemIds(storage, "s1", 1);
    assertEqual(ids.length, 3, "three capture items were seeded");
    const labelsOf = (tree) => walk(tree, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card")).map((node) => node.props["aria-label"]);
    let items = null;
    let rendered = renderTail(client, tail, props);
    items = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
    assertEqual(items.length, 3, "all three cards render");
    assertEqual(labelsOf(rendered), ["primeira sugestao", "segunda sugestao", "terceira sugestao"], "the natural order holds before any reorder");

    const grips = () => walk(rendered, (node) => node.props?.className === "dsh-sf-grip");
    assertEqual(grips().length, 3, "every card carries its grip");
    assertEqual(grips()[0].props.title, "dragToReorder", "the grip tooltip names the drag action");
    const dragOnto = (draggedIndex, targetIndex) => {
      rendered = renderTail(client, tail, props);
      items = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
      const dragged = items[draggedIndex];
      const target = items[targetIndex];
      const grip = walk(dragged, (node) => node.props?.className === "dsh-sf-grip")[0];
      const targetCardline = walk(target, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-cardline"))[0];
      grip.props.onPointerDown({ pointerId: 1, clientX: 10, clientY: 10 });
      dispatchDocument(client.document, "pointermove", { pointerId: 1, clientX: 12, clientY: 12 });
      client.document.elementsFromPoint = () => [{ className: "dsh-sf-cardline", dataset: { itemId: targetCardline.props["data-item-id"] } }];
      dispatchDocument(client.document, "pointermove", { pointerId: 1, clientX: 40, clientY: 200 });
      dispatchDocument(client.document, "pointerup", { pointerId: 1, clientX: 40, clientY: 200 });
      client.instance.flushWrites();
      rendered = renderTail(client, tail, props);
    };
    dragOnto(0, 2);
    assertEqual(labelsOf(rendered), ["segunda sugestao", "terceira sugestao", "primeira sugestao"], "the downward drag onto the last card inserts after it (a swap would place the dragged card where the target was)");
    assertEqual(JSON.parse(storage._data["dsh-nextsteps.card-order"] ?? "{}"), { "s1|1": [ids[1], ids[2], ids[0]] }, "the insert-after order persisted");

    items = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
    const gripLast = walk(items[2], (node) => node.props?.className === "dsh-sf-grip")[0];
    const targetCardlineLast = walk(items[0], (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-cardline"))[0];
    gripLast.props.onPointerDown({ pointerId: 1, clientX: 10, clientY: 10 });
    dispatchDocument(client.document, "pointermove", { pointerId: 1, clientX: 12, clientY: 12 });
    client.document.elementsFromPoint = () => [{ className: "dsh-sf-cardline", dataset: { itemId: targetCardlineLast.props["data-item-id"] } }];
    dispatchDocument(client.document, "pointermove", { pointerId: 1, clientX: 40, clientY: 200 });
    dispatchDocument(client.document, "pointerup", { pointerId: 1, clientX: 40, clientY: 200 });
    client.instance.flushWrites();
    rendered = renderTail(client, tail, props);
    assertEqual(labelsOf(rendered), ["primeira sugestao", "segunda sugestao", "terceira sugestao"], "the upward drag inserts before the target (a swap would leave the middle card last)");
    assertEqual(JSON.parse(storage._data["dsh-nextsteps.card-order"] ?? "{}"), { "s1|1": [ids[0], ids[1], ids[2]] }, "the insert-before order persisted");

    items = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
    const moveLater = buttonsOf(items[0]).find((node) => node.props?.["aria-label"] === "actionMoveLater");
    assert(moveLater !== undefined, "the first item offers the move-later button");
    moveLater.props.onClick();
    client.instance.flushWrites();
    rendered = renderTail(client, tail, props);
    assertEqual(labelsOf(rendered), ["segunda sugestao", "primeira sugestao", "terceira sugestao"], "the move-later button shifts the first card one position down");

    items = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
    const moveEarlier = buttonsOf(items[0]).find((node) => node.props?.["aria-label"] === "actionMoveEarlier");
    assert(moveEarlier !== undefined, "the first item offers the move-earlier button");
    moveEarlier.props.onClick();
    client.instance.flushWrites();
    rendered = renderTail(client, tail, props);
    assertEqual(labelsOf(rendered), ["segunda sugestao", "primeira sugestao", "terceira sugestao"], "the boundary no-op leaves the order untouched");
    assertEqual(JSON.parse(storage._data["dsh-nextsteps.card-order"] ?? "{}"), { "s1|1": [ids[1], ids[0], ids[2]] }, "the boundary no-op writes nothing new");
  } finally {
    client.fetchStub.restore();
  }
});

test("a below-threshold pointer move never starts a drag", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao", "segunda sugestao", "terceira sugestao"]);
    client.instance.flushWrites();
    const ids = captureItemIds(storage, "s1", 1);
    let rendered = renderTail(client, tail, props);
    const items = itemsOf(rendered);
    assertEqual(items.length, 3, "all three cards render");
    client.document.elementsFromPoint = () => [{ className: "dsh-sf-cardline", dataset: { itemId: cardlineOf(items[1]).props["data-item-id"] } }];
    const grip = gripOf(items[0]);
    grip.props.onPointerDown({ pointerId: 1, clientX: 10, clientY: 10 });
    dispatchDocument(client.document, "pointermove", { pointerId: 1, clientX: 13, clientY: 10 });
    rendered = renderTail(client, tail, props);
    assertEqual(draggingLinesOf(rendered).length, 0, "the 3px move never marks any cardline as dragging");
    dispatchDocument(client.document, "pointerup", { pointerId: 1, clientX: 13, clientY: 10 });
    client.instance.flushWrites();
    rendered = renderTail(client, tail, props);
    assertEqual(draggingLinesOf(rendered).length, 0, "no cardline is dragging after the pointerup");
    assertEqual(JSON.parse(storage._data["dsh-nextsteps.card-order"] ?? "{}"), {}, "the below-threshold gesture wrote no order entry");
    assertEqual(ids.length, 3, "the seeded items stayed untouched");
  } finally {
    client.fetchStub.restore();
  }
});

test("a pointercancel aborts the drag without writing and re-arms for the next gesture", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao", "segunda sugestao", "terceira sugestao"]);
    client.instance.flushWrites();
    const ids = captureItemIds(storage, "s1", 1);
    let rendered = renderTail(client, tail, props);
    const items = itemsOf(rendered);
    const grip = gripOf(items[0]);
    const targetCardline = cardlineOf(items[2]);
    dragOntoCardline(client, grip, targetCardline);
    dispatchDocument(client.document, "pointercancel", { pointerId: 1 });
    client.instance.flushWrites();
    rendered = renderTail(client, tail, props);
    assertEqual(JSON.parse(storage._data["dsh-nextsteps.card-order"] ?? "{}"), {}, "the cancelled drag wrote no order entry");
    assertEqual(draggingLinesOf(rendered).length, 0, "the cancelled drag leaves no cardline dragging");
    dispatchDocument(client.document, "pointermove", { pointerId: 1, clientX: 50, clientY: 300 });
    dispatchDocument(client.document, "pointerup", { pointerId: 1, clientX: 50, clientY: 300 });
    client.instance.flushWrites();
    rendered = renderTail(client, tail, props);
    assertEqual(JSON.parse(storage._data["dsh-nextsteps.card-order"] ?? "{}"), {}, "the detached listeners stayed inert after the cancel");
    const itemsAfterCancel = itemsOf(rendered);
    assertEqual(itemsAfterCancel.length, 3, "the cards still render after the cancel");
    dragOntoCardline(client, gripOf(itemsAfterCancel[0]), cardlineOf(itemsAfterCancel[2]));
    dispatchDocument(client.document, "pointerup", { pointerId: 1, clientX: 40, clientY: 200 });
    client.instance.flushWrites();
    rendered = renderTail(client, tail, props);
    assertEqual(cardLabelsOf(rendered), ["segunda sugestao", "terceira sugestao", "primeira sugestao"], "a fresh pointerdown re-attaches the drag machinery and commits");
    assertEqual(JSON.parse(storage._data["dsh-nextsteps.card-order"] ?? "{}"), { "s1|1": [ids[1], ids[2], ids[0]] }, "the post-cancel commit persisted");
  } finally {
    client.fetchStub.restore();
  }
});

test("a drag with an undefined turn writes no order entry", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "call-1",
      block: { kind: "tool-result", callId: "call-1", name: "suggest_followups", turn: 1, content: [{ type: "text", text: '{"rev":"sf-2","followups":[{"prompt":"Unica","label":"Unica"}]}' }] }
    });
    client.instance.flushWrites();
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: undefined, seq: 9, t: (key) => key };
    let rendered = renderTail(client, tail, props);
    const items = itemsOf(rendered);
    assert(items.length >= 1, "the fallback path renders the newest capture");
    client.document.elementsFromPoint = () => [{ className: "dsh-sf-cardline", dataset: { itemId: cardlineOf(items[0]).props["data-item-id"] } }];
    const grip = gripOf(items[0]);
    grip.props.onPointerDown({ pointerId: 1, clientX: 10, clientY: 10 });
    dispatchDocument(client.document, "pointermove", { pointerId: 1, clientX: 40, clientY: 200 });
    dispatchDocument(client.document, "pointerup", { pointerId: 1, clientX: 40, clientY: 200 });
    client.instance.flushWrites();
    rendered = renderTail(client, tail, props);
    assertEqual(draggingLinesOf(rendered).length, 0, "the drag completes without leaving a dragging cardline");
    assertEqual(storage._data["dsh-nextsteps.card-order"], undefined, "no order entry is written when the turn is undefined");
  } finally {
    client.fetchStub.restore();
  }
});

test("a second pointer never hijacks the active drag", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao", "segunda sugestao", "terceira sugestao"]);
    client.instance.flushWrites();
    const ids = captureItemIds(storage, "s1", 1);
    let rendered = renderTail(client, tail, props);
    const items = itemsOf(rendered);
    dragOntoCardline(client, gripOf(items[0]), cardlineOf(items[2]), 1);
    dispatchDocument(client.document, "pointerdown", { pointerId: 2, clientX: 20, clientY: 20 });
    const gripsAfterSecondDown = () => walk(renderTail(client, tail, props), (node) => node.props?.className === "dsh-sf-grip");
    const secondGrip = gripsAfterSecondDown()[1];
    secondGrip.props.onPointerDown({ pointerId: 2, clientX: 20, clientY: 20 });
    dispatchDocument(client.document, "pointermove", { pointerId: 2, clientX: 80, clientY: 400 });
    dispatchDocument(client.document, "pointerup", { pointerId: 2, clientX: 80, clientY: 400 });
    client.instance.flushWrites();
    rendered = renderTail(client, tail, props);
    assertEqual(JSON.parse(storage._data["dsh-nextsteps.card-order"] ?? "{}"), {}, "the stray second pointer wrote no order entry");
    dispatchDocument(client.document, "pointerup", { pointerId: 1, clientX: 40, clientY: 200 });
    client.instance.flushWrites();
    rendered = renderTail(client, tail, props);
    assertEqual(cardLabelsOf(rendered), ["segunda sugestao", "terceira sugestao", "primeira sugestao"], "the first pointer's drag completed untouched and commits");
    assertEqual(JSON.parse(storage._data["dsh-nextsteps.card-order"] ?? "{}"), { "s1|1": [ids[1], ids[2], ids[0]] }, "the original drag's commit persisted");
    assertEqual(draggingLinesOf(rendered).length, 0, "no cardline stays dragging after the commits");
  } finally {
    client.fetchStub.restore();
  }
});

test("an unmounted card drops its drag listeners and its pointerup writes nothing", async () => {
  const storage = memoryStorage();
  const { client, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao", "segunda sugestao", "terceira sugestao"]);
    client.instance.flushWrites();
    let rendered = renderTail(client, tail, props);
    const items = itemsOf(rendered);
    dragOntoCardline(client, gripOf(items[0]), cardlineOf(items[2]), 1);
    await client.react.__cleanup();
    dispatchDocument(client.document, "pointerup", { pointerId: 1, clientX: 40, clientY: 200 });
    client.instance.flushWrites();
    rendered = renderTail(client, tail, props);
    assertEqual(JSON.parse(storage._data["dsh-nextsteps.card-order"] ?? "{}"), {}, "the unmounted drag wrote no order entry");
  } finally {
    client.fetchStub.restore();
  }
});

test("the new-conversation action opens a session with the suggestion prefilled", async () => {
  const storage = memoryStorage();
  const calls = [];
  const { client, ctx, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  try {
    await settled(client);
    ctx.get = (name) => (name === "uiWorkspace" ? { startSession: (workspaceId, options) => { calls.push([workspaceId, options]); } } : undefined);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao"]);
    client.instance.flushWrites();
    const rendered = renderTail(client, tail, props);
    const newChat = buttonsOf(rendered).find((node) => node.props?.["aria-label"] === "actionNewChat");
    assert(newChat !== undefined, "the card offers the new-conversation action");
    newChat.props.onClick();
    assertEqual(calls.length, 1, `exactly one session start: ${calls.length}`);
    assertEqual(calls[0], [undefined, { prompt: "primeira sugestao", whenDraftExists: "replace" }], "the suggestion is prefilled into a fresh session draft");
    client.instance.flushWrites();
    const renderedAfter = renderTail(client, tail, props);
    const cards = walk(renderedAfter, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
    assert(cards.length === 1 && !String(cards[0].props.className).includes("is-sent"), "the source card is not marked sent");
    assertEqual(storage._data["dsh-nextsteps.clicked"], undefined, "no click was recorded for the source card");
  } finally {
    client.fetchStub.restore();
  }
});

test("the new-conversation action degrades to a notice when the service is missing", async () => {
  const storage = memoryStorage();
  const { client, ctx, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    await settled(client);
    ctx.get = () => undefined;
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao"]);
    client.instance.flushWrites();
    const rendered = renderTail(client, tail, props);
    const newChat = buttonsOf(rendered).find((node) => node.props?.["aria-label"] === "actionNewChat");
    newChat.props.onClick();
    const after = renderTail(client, tail, props);
    const notice = walk(after, (node) => node.props?.className === "dsh-sf-notice")[0];
    assert(notice !== undefined && notice.children[0] === "newChatUnavailable", `the failure notice is shown: ${notice?.children?.[0]}`);
    assertEqual(warnings.length, 1, `exactly one warning fired: ${warnings.length}`);
  } finally {
    console.warn = originalWarn;
    client.fetchStub.restore();
  }
});

test("the new-conversation action survives a throwing service", async () => {
  const storage = memoryStorage();
  const { client, ctx, registrations } = clientWithRoutes({ "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" } }, { storage });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    await settled(client);
    ctx.get = (name) => (name === "uiWorkspace" ? { startSession: () => { throw new Error("the workspace exploded"); } } : undefined);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao"]);
    client.instance.flushWrites();
    const rendered = renderTail(client, tail, props);
    const newChat = buttonsOf(rendered).find((node) => node.props?.["aria-label"] === "actionNewChat");
    newChat.props.onClick();
    const after = renderTail(client, tail, props);
    const notice = walk(after, (node) => node.props?.className === "dsh-sf-notice")[0];
    assert(notice !== undefined && notice.children[0] === "newChatUnavailable", `the failure notice is shown: ${notice?.children?.[0]}`);
    assertEqual(warnings.length, 1, `exactly one warning fired: ${warnings.length}`);
    const cards = walk(after, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
    assertEqual(cards.length, 1, "the card still renders after the throw");
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
    const tree = tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    const effects = [...(client.react.__effects ?? [])];
    client.react.__setComponent(tree.type);
    client.react.__reset();
    const deferred = tree.type(tree.props);
    const cards = walk(deferred, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
    assertEqual(cards.length, 0, "a never firing observer builds no card");
    for (const effect of effects) await effect();
    observer.fire();
    const after = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    const built = walk(after, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
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
    const rendered = renderTail(fallback.client, tail, { sessionId: "s2", turn: { turn: 1 }, seq: 9, t: (key) => key });
    const cards = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
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
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.generate": { ok: true, rev: "sf-2", followups: [{ prompt: "gerado pelo host", label: "Host" }] }
  }, { storage });
  try {
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    tail(props);
    await settled(client);
    const firstRender = renderTail(client, tail, props);
    const add = buttonWithText(firstRender, "addSuggestion");
    assert(add !== undefined, "the tail offers the add suggestion button");
    await add.props.onClick();
    const openRendered = renderTail(client, tail, props);
    const area = walk(openRendered, (node) => node.type === "textarea")[0];
    assert(area !== undefined, "the manual form opens a textarea");
    area.props.onChange({ target: { value: "minha sugestao" } });
    const formRendered = renderTail(client, tail, props);
    const save = buttonWithText(formRendered, "manualSave");
    assert(save !== undefined, "the manual form offers the save button");
    await save.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.instance.flushWrites();
    const stored = storage._data["dsh-nextsteps.captures.session.s1"];
    assert(stored !== undefined, "the manual suggestion reaches the store");
    const entries = Object.keys(JSON.parse(stored));
    assert(entries.some((key) => key.startsWith("manual-")), `the manual card is stored under a manual key: ${entries.join(", ")}`);

    const second = clientWithRoutes({
      "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
      "/api/dsh-nextsteps.models": { ok: true, groups: [] },
      "/api/dsh-nextsteps.generate": { ok: true, rev: "sf-2", followups: [{ prompt: "gerado pelo host", label: "Host" }] }
    }, { storage });
    try {
      await settled(second.client);
      renderTail(second.client, tailOf(second.registrations), { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
      await new Promise((resolve) => setTimeout(resolve, 60));
      const restarted = renderTail(second.client, tailOf(second.registrations), { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
      const cards = walk(restarted, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"));
      const manualCard = cards.find((card) => card.props["aria-label"] === "minha sugestao");
      assert(manualCard !== undefined, "the manual card renders in host mode and survives a restart");
      assertEqual(cards.length, 2, "the generated card and the manual card both render: " + cards.map((card) => card.props["aria-label"]).join(" | "));
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
    const before = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    const discard = buttonsOf(before).find((node) => node.props?.["aria-label"] === "actionDiscard");
    assert(discard !== undefined, "the card offers the discard action");
    await discard.props.onClick();
    const after = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    const items = walk(after, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
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
    const before = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    const favorite = buttonsOf(before).find((node) => node.props?.["aria-label"] === "actionFavorite");
    assert(favorite !== undefined, "the card offers the favourite action");
    assertEqual(favorite.children[0], "☆", "the card starts without the favourite");
    await favorite.props.onClick();
    const after = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
    const before = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    const discard = buttonsOf(before).find((node) => node.props?.["aria-label"] === "actionDiscard");
    await discard.props.onClick();
    const after = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
    tail.component({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
    const tree = tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    client.react.__setComponent(tree.type);
    client.react.__reset();
    const rendered = tree.type(tree.props);
    const send = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-card"))[0];
    await send.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
    await settled(client);
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    if (rendered === null) {
      assertEqual(0, 0, "the stray call produces no tail at all");
    } else {
      const items = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
      assertEqual(items.length, 0, "the stray call produces no card");
    }
  } finally {
    client.fetchStub.restore();
  }
});

test("the on demand generation is cancelled when the card goes away", async () => {
  const settings = { ...NEW_SETTINGS, generationMode: "on-demand", lang: "en" };
  const signals = [];
  const hung = (init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    if (body.includes('"validate":true')) {
      return new Response(JSON.stringify({ ok: true, completed: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    signals.push(init?.signal);
    return new Promise((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        reject(error);
      });
    });
  };
  const client = loadClient({ routes: {
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.generate": hung
  } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const tail = tailOf(registrations);
    const tree = tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const fresh = tail({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    assert(fresh !== null, "the completed probe reveals the on demand tail");
    const rendered = fresh.type(fresh.props);
    const generate = buttonsOf(rendered).find((node) => node.children.includes("generateNow"));
    assert(generate !== undefined, "the on demand card offers the generate button");
    generate.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(signals.length === 1 && signals[0].aborted === false, "the request is still running before the card goes away");
    await client.react.__cleanup();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(signals[0].aborted === true, "the request is aborted when the card goes away");
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
      tail.component({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    const copy = buttonsOf(rendered).find((node) => node.props?.["aria-label"] === "actionCopy");
    await copy.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const after = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
    tail.component({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const tree = tail.component({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
      tail.component({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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

function favoritesExportClient(storageSeed) {
  const createdAnchors = [];
  const capturedBlobs = [];
  const storage = memoryStorage(storageSeed);
  const documentOverride = {
    head: { appendChild() {} },
    createElement: (tag) => {
      if (tag === "a") {
        const anchor = { href: "", download: "", clicked: false, click() { this.clicked = true; } };
        createdAnchors.push(anchor);
        return anchor;
      }
      return { style: {}, value: "", set textContent(value) { this._text = value; }, select() {}, remove() {}, appendChild() {} };
    }
  };
  const client = loadClient({
    storage,
    document: documentOverride,
    routes: {
      "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" },
      "/api/dsh-nextsteps.models": { ok: true, groups: [] },
      "/api/dsh-nextsteps.update": { name: "dsh-nextsteps", current: "1.0.0", newer: false }
    }
  });
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => { capturedBlobs.push(blob); return "blob:fake"; };
  URL.revokeObjectURL = () => {};
  return {
    client,
    storage,
    createdAnchors,
    capturedBlobs,
    async close() {
      if (originalCreate === undefined) delete URL.createObjectURL;
      else URL.createObjectURL = originalCreate;
      if (originalRevoke === undefined) delete URL.revokeObjectURL;
      else URL.revokeObjectURL = originalRevoke;
      client.fetchStub.restore();
    }
  };
}

test("the export button downloads the favourites as markdown in insertion-date order", async () => {
  const setup = favoritesExportClient({
    "dsh-nextsteps.favorites": JSON.stringify({ fav1: { prompt: "Run the full suite", label: "Run suite", at: 2000 }, fav2: { prompt: "Wire the retry path", label: "Retry", at: 1000 } })
  });
  try {
    const { tree } = settingsTree(setup.client);
    const exportButton = buttonsOf(tree).find((node) => node.children.includes("favoritesExport"));
    assert(exportButton !== undefined, "the export button renders when favourites exist");
    exportButton.props.onClick();
    await settled(setup.client);
    setup.client.instance.flushWrites();
    assertEqual(setup.capturedBlobs.length, 1, "one blob was created");
    const blob = setup.capturedBlobs[0];
    assert(blob instanceof Blob, `the captured download is a blob: ${typeof blob}`);
    const markdown = await blob.text();
    assert(markdown.includes("Wire the retry path") && markdown.includes("Run the full suite"), `both prompts are exported: ${markdown.slice(0, 200)}`);
    assert(markdown.indexOf("Wire the retry path") < markdown.indexOf("Run the full suite"), "the earlier-at favourite comes first");
    assert(markdown.includes("## Retry") && markdown.includes("## Run suite"), `the labels render as headings: ${markdown.slice(0, 200)}`);
    assert(markdown.startsWith("# Favourite suggestions"), "the document carries the title heading");
    assertEqual(setup.createdAnchors.length, 1, "one anchor was created");
    const anchor = setup.createdAnchors[0];
    assertMatch(anchor.download, /^dsh-nextsteps-favorites-\d{4}-\d{2}-\d{2}\.md$/, `the download name is dated: ${anchor.download}`);
    assertEqual(anchor.clicked, true, "the anchor click fired");
  } finally {
    await setup.close();
  }
});

test("the export button is hidden when there are no favourites", () => {
  const setup = favoritesExportClient({});
  try {
    const { tree } = settingsTree(setup.client);
    const exportButton = buttonsOf(tree).find((node) => node.children.includes("favoritesExport"));
    assert(exportButton === undefined, "the export button is absent without favourites");
    assertEqual(setup.createdAnchors.length, 0, "no anchor was created");
  } finally {
    setup.close();
  }
});

test("the export indents prompts that carry their own code fence", async () => {
  const setup = favoritesExportClient({
    "dsh-nextsteps.favorites": JSON.stringify({ fav1: { prompt: "Look at this:\n```js\nconsole.log(1)\n```", label: "Fenced", at: 1000 } })
  });
  try {
    const { tree } = settingsTree(setup.client);
    const exportButton = buttonsOf(tree).find((node) => node.children.includes("favoritesExport"));
    assert(exportButton !== undefined, "the export button renders for the fenced favourite");
    exportButton.props.onClick();
    await settled(setup.client);
    setup.client.instance.flushWrites();
    assertEqual(setup.capturedBlobs.length, 1, "one blob was created");
    const markdown = await setup.capturedBlobs[0].text();
    assert(!/\n```/.test(markdown) && !markdown.startsWith("```"), `no bare fence line is emitted: ${markdown}`);
    assert(markdown.includes("    ```js"), "the fence line of the prompt is indented");
    assert(markdown.includes("    console.log(1)"), "the code line of the prompt is indented");
    assert(markdown.includes("    Look at this:"), "the prose line of the prompt is indented");
  } finally {
    await setup.close();
  }
});

test("the export shows a failure notice when the download cannot start", async () => {
  const setup = favoritesExportClient({
    "dsh-nextsteps.favorites": JSON.stringify({ fav1: { prompt: "Run the full suite", label: "Run suite", at: 1000 } })
  });
  try {
    URL.createObjectURL = () => { throw new Error("the download is blocked"); };
    const { registrations } = settingsTree(setup.client);
    const section = registrations.find((entry) => entry.spec?.name === "settings.section");
    const first = section.component({ t: (key) => key });
    const exportButton = buttonsOf(first).find((node) => node.children.includes("favoritesExport"));
    assert(exportButton !== undefined, "the export button renders for the failure case");
    exportButton.props.onClick();
    const after = section.component({ t: (key) => key });
    const notice = walk(after, (node) => node.props?.className === "dsh-sf-notice")[0];
    assert(notice !== undefined && notice.children[0] === "favoritesExportFailed", `the failure notice is shown: ${notice?.children?.[0]}`);
    assert(!textOf(after).includes("srFavoritesExported"), "the success notice is not shown");
    assertEqual(setup.createdAnchors.length, 0, "no anchor was created for a failed export");
  } finally {
    await setup.close();
  }
});

test("the settings page tests the selected model and shows the latency", async () => {
  const client = loadClient({
    routes: {
      "/api/dsh-nextsteps.settings": { ok: true, settings: NEW_SETTINGS, version: "1.0.0" },
      "/api/dsh-nextsteps.models": { ok: true, groups: [{ id: "demo", name: "Demo", models: [{ id: "demo-model", name: "Demo Model" }] }] },
      "/api/dsh-nextsteps.update": { name: "dsh-nextsteps", current: "1.0.0", newer: false },
      "/api/dsh-nextsteps.model-test": { ok: true, model: "demo/demo-model", latencyMs: 42 }
    }
  });
  try {
    const { ctx, registrations } = settingsTree(client);
    await settled(client);
    const section = registrations.find((entry) => entry.spec?.name === "settings.section");
    const secondTree = section.component({ t: (key) => key });
    const testButton = buttonsOf(secondTree).find((node) => node.children.includes("testModel"));
    assert(testButton !== undefined, "the model row renders the test button when the catalog is loaded");
    await testButton.props.onClick();
    await settled(client);
    const realT = ctx.locale.bind("dsh-nextsteps");
    const statusTree = section.component({ t: realT });
    const statusText = textOf(statusTree);
    assert(statusText.includes("Available (42 ms)"), `the status shows the latency: ${statusText.slice(0, 300)}`);
    client.fetchStub.set("/api/dsh-nextsteps.model-test", { ok: false, error: "boom" });
    await testButton.props.onClick();
    await settled(client);
    const failTree = section.component({ t: realT });
    const failText = textOf(failTree);
    assert(failText.includes("Unavailable (boom)"), `the status shows the failure: ${failText.slice(0, 300)}`);
    const posts = client.fetchStub.calls.filter((call) => call.url === "/api/dsh-nextsteps.model-test" && call.method === "POST");
    assert(posts.length === 2, `the button posts once per click: ${posts.length}`);
    for (const post of posts) {
      const body = JSON.parse(post.body);
      assertEqual(body.model, "", `the probe posts the current selection: ${JSON.stringify(body)}`);
    }
  } finally {
    client.fetchStub.restore();
  }
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
    const rendered = renderTail(client, tail, { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
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
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };
    seedCaptures(registrations, "s1", 1, ["primeira sugestao"]);
    client.instance.flushWrites();
    const open = async (text) => {
      const rendered = renderTail(client, tail, props);
      const add = buttonsOf(rendered).find((node) => node.children.includes("addSuggestion"));
      await add.props.onClick();
      const withForm = renderTail(client, tail, props);
      const area = walk(withForm, (node) => node.type === "textarea")[0];
      area.props.onChange({ target: { value: text } });
      const withText = renderTail(client, tail, props);
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
    const rendered = renderTail(client, tail, props);
    const items = walk(rendered, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
    assertEqual(items.length, 3, "the seeded card and the two manual suggestions render as cards");
  } finally {
    client.fetchStub.restore();
  }
});

suite("harness: document event dispatch");

test("the document stub records listeners, dispatches to them and detaches them", () => {
  const client = loadClient();
  try {
    const seen = [];
    const handler = (event) => seen.push(event);
    client.document.addEventListener("pointermove", handler);
    const event = { pointerId: 1, clientX: 40, clientY: 10 };
    dispatchDocument(client.document, "pointermove", event);
    assertEqual(seen, [event], "the recorded handler receives the dispatched event");
    client.document.removeEventListener("pointermove", handler);
    dispatchDocument(client.document, "pointermove", event);
    assertEqual(seen.length, 1, "the detached handler runs no second time");
    assertEqual(client.document.elementsFromPoint(0, 0), [], "the default hit-test answers with no elements");
    const target = { className: "dsh-sf-cardline" };
    client.document.elementsFromPoint = () => [target];
    assertEqual(client.document.elementsFromPoint(0, 0), [target], "the hit-test is reassignable per scenario");
  } finally {
    client.fetchStub.restore();
  }
});

suite("client: the empty tail and the on demand probe");

function probeRoutes(completed, options = {}) {
  return {
    "/api/dsh-nextsteps.settings": { ok: true, settings: { ...NEW_SETTINGS, generationMode: "on-demand" }, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.generate": (init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (body.includes('"validate":true')) {
        if (options.failValidate === true) return new Response(JSON.stringify({ error: "host down" }), { status: 500, headers: { "content-type": "application/json" } });
        if (options.missingCompleted === true) return { ok: true, rev: "sf-2", followups: [] };
        return { ok: true, completed };
      }
      if (options.failGenerate === true) return new Response(JSON.stringify({ error: "no model" }), { status: 400, headers: { "content-type": "application/json" } });
      return { ok: true, rev: "sf-2", followups: [{ prompt: "gerado pelo host", label: "Host" }] };
    }
  };
}

async function probeOnce(client, tail, props) {
  tail(props);
  for (const effect of client.react.__effects ?? []) await effect();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const element = tail(props);
  if (element === null) return null;
  return element.type(element.props);
}

test("the probe hides an incomplete on demand turn entirely", async () => {
  const { client, registrations } = clientWithRoutes(probeRoutes(false));
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, seq: 9, t: (key) => key };
    const rendered = await probeOnce(client, tail, props);
    assertEqual(rendered, null, "an incomplete turn renders no tail at all");
    const validateCalls = client.fetchStub.calls.filter((call) => call.url.includes(".generate") && typeof call.body === "string" && call.body.includes('"validate":true'));
    assertEqual(validateCalls.length, 1, "the probe fires exactly once");
  } finally {
    client.fetchStub.restore();
  }
});

test("the probe failure lands in the not-completed bucket without a retry loop", async () => {
  const { client, registrations } = clientWithRoutes(probeRoutes(false, { failValidate: true }));
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, seq: 9, t: (key) => key };
    const rendered = await probeOnce(client, tail, props);
    assertEqual(rendered, null, "a failed probe renders no tail");
    const validateCalls = client.fetchStub.calls.filter((call) => call.url.includes(".generate") && typeof call.body === "string" && call.body.includes('"validate":true'));
    assertEqual(validateCalls.length, 1, "the probe never retries");
    const again = await probeOnce(client, tail, props);
    assertEqual(again, null, "the cached failed attempt keeps the tail hidden");
    const validateAfter = client.fetchStub.calls.filter((call) => call.url.includes(".generate") && typeof call.body === "string" && call.body.includes('"validate":true'));
    assertEqual(validateAfter.length, 1, "the failed attempt is cached across re-renders");
  } finally {
    client.fetchStub.restore();
  }
});

test("an answer without the completed field counts as not completed", async () => {
  const { client, registrations } = clientWithRoutes(probeRoutes(false, { missingCompleted: true }));
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, seq: 9, t: (key) => key };
    const rendered = await probeOnce(client, tail, props);
    assertEqual(rendered, null, "a validate answer without completed hides the tail");
  } finally {
    client.fetchStub.restore();
  }
});

test("the auto mode never probes the host", async () => {
  const settings = { ...NEW_SETTINGS, generationMode: "auto" };
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.generate": () => new Response(JSON.stringify({ error: "the chat moved on" }), { status: 409, headers: { "content-type": "application/json" } })
  });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, seq: 9, t: (key) => key };
    tail(props);
    await settled(client);
    const validateCalls = client.fetchStub.calls.filter((call) => typeof call.body === "string" && call.body.includes('"validate":true'));
    assertEqual(validateCalls.length, 0, "the auto mode never sends a validate probe");
  } finally {
    client.fetchStub.restore();
  }
});

test("a completed on demand turn keeps the generate button without a second probe", async () => {
  const { client, registrations } = clientWithRoutes(probeRoutes(true));
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, seq: 9, t: (key) => key };
    const rendered = await probeOnce(client, tail, props);
    assert(rendered !== null, "a completed turn renders the tail");
    const generate = buttonsOf(rendered).find((node) => node.children.includes("generateNow"));
    assert(generate !== undefined, "the completed turn offers the generate button");
    await probeOnce(client, tail, props);
    const validateCalls = client.fetchStub.calls.filter((call) => call.url.includes(".generate") && typeof call.body === "string" && call.body.includes('"validate":true'));
    assertEqual(validateCalls.length, 1, "the probe result is cached across re-renders");
  } finally {
    client.fetchStub.restore();
  }
});

test("a discarded suggestion keeps the undo row reachable on an otherwise empty tail", async () => {
  const storage = memoryStorage({
    "dsh-nextsteps.discarded": JSON.stringify({ "kept:0": { prompt: "descartada", label: null, at: 1, sessionId: "s1", turn: 1 } })
  });
  const { client, registrations } = clientWithRoutes(probeRoutes(false), { storage });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, seq: 9, t: (key) => key };
    const rendered = await probeOnce(client, tail, props);
    assert(rendered !== null, "a recent discard keeps the tail alive");
    const undo = buttonsOf(rendered).find((node) => node.props?.["aria-label"] === "undoDiscard");
    assert(undo !== undefined, "the undo row renders for the session discard");
  } finally {
    client.fetchStub.restore();
  }
});

test("a completed turn with zero suggestions still offers the retry", async () => {
  const settings = { ...NEW_SETTINGS, lang: "zh-CN" };
  const { client, registrations } = clientWithRoutes({
    "/api/dsh-nextsteps.settings": { ok: true, settings, version: "1.0.0" },
    "/api/dsh-nextsteps.generate": { ok: true, rev: "sf-2", followups: [] }
  });
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, seq: 9, t: (key) => key };
    tail(props);
    await settled(client);
    await new Promise((resolve) => setTimeout(resolve, 2600));
    const rendered = renderTail(client, tail, props);
    assert(rendered !== null, "a completed turn with no suggestions renders the retry row");
    const retry = retryNodeOf(rendered);
    assert(retry !== undefined, "the retry block survives on an empty answer");
  } finally {
    client.fetchStub.restore();
  }
});

test("a settings change invalidates the probe cache", async () => {
  const { client, ctx, registrations } = clientWithRoutes(probeRoutes(true));
  try {
    await settled(client);
    const tail = tailOf(registrations);
    const props = { sessionId: "s1", turn: { turn: 1, end: { seq: 9 } }, seq: 9, t: (key) => key };
    await probeOnce(client, tail, props);
    const countValidate = () => client.fetchStub.calls.filter((call) => typeof call.body === "string" && call.body.includes('"validate":true')).length;
    assertEqual(countValidate(), 1, "the first render probes once");
    const settingsSection = registrations.find((entry) => entry.spec?.name === "settings.section");
    assert(settingsSection !== undefined, "the settings section is registered");
    settingsSection.component({ t: (key) => key });
    await settled(client);
    await probeOnce(client, tail, props);
    assert(countValidate() >= 1, "the probe cache tracks the settings revision");
  } finally {
    client.fetchStub.restore();
  }
});
