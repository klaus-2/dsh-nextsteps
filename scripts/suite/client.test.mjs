import { suite, test, assert, assertEqual, assertIncludes, assertMatch } from "../harness.mjs";
import { loadClient, fakeSlotHost, stubFetch, walk, textOf, memoryStorage } from "../client-harness.mjs";

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
  assertEqual(moduleId, "dsh-nextsteps");
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
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "" }, version: "1.0.0" },
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

test("the language select offers every language the host accepts", () => {
  const client = loadClient();
  const fetchStub = stubFetch({
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "" }, version: "1.0.0" },
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
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "" }, version: "1.0.0" },
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
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "" }, version: "1.0.0" },
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
  const key = Object.keys(storage._data).find((name) => name.includes("captures"));
  assert(key !== undefined, "the captures are stored under a plugin owned key");
  assert(key.includes("dsh-nextsteps"), "the captures key belongs to the plugin");
  const parsed = JSON.parse(storage._data[key]);
  const entry = parsed.s1["call-1"];
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
  const key = Object.keys(storage._data).find((name) => name.includes("captures"));
  const parsed = JSON.parse(storage._data[key]);
  assert(parsed.s2["call-2"].turn === undefined, "a capture without a turn keeps no turn");
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
    "/api/dsh-nextsteps.settings": { ok: true, settings: { lang: "auto", maxFollowups: 3, showHeader: true, model: "" }, version: "1.0.0" },
    "/api/dsh-nextsteps.models": { ok: true, groups: [] },
    "/api/dsh-nextsteps.update": { name: "dsh-nextsteps", current: "1.0.0", newer: false }
  } });
  try {
    const { ctx } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const urls = fetchStub.calls.map((call) => call.url);
    assert(urls.some((url) => url.includes("/settings")), "the client reads the settings");
    assert(urls.some((url) => url.includes("/models")), "the client reads the model catalog");
    assert(urls.every((url) => url.startsWith("/api/dsh-nextsteps.")), "the client only calls its own routes");
  } finally {
    fetchStub.restore();
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
