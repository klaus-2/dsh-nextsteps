import { suite, test, assert, assertEqual, pluginId } from "../harness.mjs";
import { loadClient, fakeSlotHost, walk, failingStorage, memoryStorage } from "../client-harness.mjs";

const SETTINGS_FIXTURE = {
  lang: "auto",
  maxFollowups: 3,
  showHeader: true,
  model: "",
  styles: ["next-action", "explore", "deep-dive"],
  generationMode: "auto",
  latencyBudgetMs: 30000,
  maxSuggestionChars: 200
};

suite("store: keyed local store");

test("a refused setItem retries after the backoff window and persists the exact payload", async () => {
  const favoritesKey = `${pluginId}.favorites`;
  const orderKey = `${pluginId}.favorites-order`;
  const seed = {
    "fav-alpha": { prompt: "Fav alpha", label: null, at: 1000 },
    "fav-beta": { prompt: "Fav beta", label: null, at: 2000 }
  };
  const storage = failingStorage({
    initial: { [favoritesKey]: JSON.stringify(seed) },
    failSetItemTimes: 1
  });
  const client = loadClient({
    storage,
    routes: {
      [`/api/${pluginId}.settings`]: { ok: true, settings: SETTINGS_FIXTURE, version: "1.0.0" }
    }
  });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    const settings = registrations.find((entry) => entry.spec?.name === "settings.section");
    assert(settings !== undefined, "the settings section is registered");
    const tree = settings.component({ t: (key) => key });
    const betaRow = walk(tree, (node) => node.props?.["data-fav-id"] === "fav-beta")[0];
    assert(betaRow !== undefined, "the second favourite row is rendered");
    const moveEarlier = walk(betaRow, (node) => node.type === "button" && node.props?.["aria-label"] === "actionMoveEarlier")[0];
    assert(moveEarlier !== undefined, "the second favourite row offers move-earlier");
    await moveEarlier.props.onClick();

    client.instance.flushWrites();
    assertEqual(storage.setAttempts, 1, "the initial flush attempted setItem once");
    assertEqual(storage.setAttemptsByKey.get(orderKey), 1, "the attempt targeted the favourites-order key");
    assertEqual(storage._data[orderKey], undefined, "the refused write did not land in storage");

    await new Promise((resolve) => setTimeout(resolve, 270));
    client.instance.flushWrites();
    assertEqual(storage.setAttempts, 2, "the retry attempted setItem a second time");
    assertEqual(storage.setAttemptsByKey.get(orderKey), 2, "both attempts targeted the favourites-order key");
    assertEqual(storage._data[orderKey], JSON.stringify(["fav-beta", "fav-alpha"]), "the exact payload landed on retry");
    assertEqual(client.warnings.length, 0, "a write that succeeds on retry emits no drop warning");
  } finally {
    client.fetchStub.restore();
  }
});

test("write returns equivalent state through readState on immediate persistence and while retry is pending", async () => {
  const immediateKey = `${pluginId}.store-probe-immediate`;
  const retryKey = `${pluginId}.store-probe-retry`;
  const storage = failingStorage({
    failSetItemTimes: { [retryKey]: 1 }
  });
  const client = loadClient({ storage });
  try {
    const immediateHandle = client.instance.localStore.handle(immediateKey);
    const expectedImmediate = { order: ["alpha", "beta"], count: 2 };
    const immediateOk = immediateHandle.write(JSON.stringify(expectedImmediate));
    assertEqual(immediateOk, true, "write returns true when setItem succeeds synchronously");
    assertEqual(storage._data[immediateKey], JSON.stringify(expectedImmediate), "the exact payload lands synchronously");
    assertEqual(
      immediateHandle.readState(() => JSON.parse(immediateHandle.read() ?? "{}"), {}),
      expectedImmediate,
      "readState returns the exact state persisted by write"
    );

    const retryHandle = client.instance.localStore.handle(retryKey);
    const expectedRetry = { items: ["gamma", "delta"], version: 3 };
    const retryOk = retryHandle.write(JSON.stringify(expectedRetry));
    assertEqual(retryOk, false, "write returns false when the synchronous setItem is refused");
    assertEqual(storage._data[retryKey], undefined, "the refused write has not landed in storage yet");
    assertEqual(
      retryHandle.readState(() => ({ stale: true }), {}),
      expectedRetry,
      "readState returns the pending payload identically before retry flushes"
    );

    await new Promise((resolve) => setTimeout(resolve, 270));
    client.instance.flushWrites();
    assertEqual(storage._data[retryKey], JSON.stringify(expectedRetry), "the exact payload lands on retry");
    assertEqual(
      retryHandle.readState(() => JSON.parse(retryHandle.read() ?? "{}"), {}),
      expectedRetry,
      "readState returns the persisted state identically after retry flushes"
    );
  } finally {
    client.fetchStub.restore();
  }
});

test("subscribe fires once per write across immediate writes, queued retries, silent remove, and unsubscription", async () => {
  const immediateKey = `${pluginId}.store-notify-immediate`;
  const retryKey = `${pluginId}.store-notify-retry`;
  const storage = failingStorage({
    failSetItemTimes: { [retryKey]: 1 }
  });
  const client = loadClient({ storage });
  try {
    const immediateHandle = client.instance.localStore.handle(immediateKey);
    const immediateEvents = [];
    const unsubscribe = immediateHandle.subscribe((sessionId) => {
      immediateEvents.push(sessionId);
    });
    assertEqual(immediateHandle.write(JSON.stringify({ step: 1 }), "s-1"), true, "first immediate write succeeds");
    assertEqual(immediateEvents, ["s-1"], "one write notifies once with the session id");
    assertEqual(immediateHandle.write(JSON.stringify({ step: 2 }), "s-2"), true, "second immediate write succeeds");
    assertEqual(immediateEvents, ["s-1", "s-2"], "two write operations produce two notifications");
    unsubscribe();
    immediateHandle.write(JSON.stringify({ step: 3 }), "s-3");
    assertEqual(immediateEvents.length, 2, "unsubscribed listener receives no further notifications");

    const retryHandle = client.instance.localStore.handle(retryKey);
    const retryEvents = [];
    retryHandle.subscribe((sessionId) => {
      retryEvents.push(sessionId);
    });
    assertEqual(retryHandle.write(JSON.stringify({ retry: true }), "s-retry"), false, "refused write returns false");
    assertEqual(retryEvents, ["s-retry"], "subscribe fires once when write queues a retry");

    await new Promise((resolve) => setTimeout(resolve, 270));
    client.instance.flushWrites();
    assertEqual(storage._data[retryKey], JSON.stringify({ retry: true }), "queued retry persists the exact payload");
    assertEqual(retryEvents.length, 1, "flushing the retry does not notify subscribers again");

    const updateHandle = client.instance.localStore.handles.update;
    const updateEvents = [];
    updateHandle.subscribe(() => {
      updateEvents.push("updated");
    });
    assertEqual(updateHandle.write("1.10.1"), true, "update handle write succeeds");
    assertEqual(storage._data[`${pluginId}.updated`], "1.10.1", "update handle persists the version string");
    assertEqual(updateEvents.length, 1, "update handle write notifies once");
    updateHandle.remove({ notify: false });
    assertEqual(storage._data[`${pluginId}.updated`], undefined, "silent remove clears the update key synchronously");
    assertEqual(updateEvents.length, 1, "silent remove emits no notification");
  } finally {
    client.fetchStub.restore();
  }
});

function renderTail(client, tail, props) {
  const tree = tail(props);
  if (tree === null) return null;
  client.react.__setComponent(tree.type);
  client.react.__reset();
  return tree.type(tree.props);
}

test("group B domain memory handles route private sessions to memory without touching storage and clear on memoryDelete", async () => {
  const privateKey = `${pluginId}.private-sessions`;
  const instructionsKey = `${pluginId}.session-instructions`;
  const notRelevantKey = `${pluginId}.not-relevant`;
  const initialInstructions = JSON.stringify({ "s-pub": "public rule", "s-priv": "stale disk leak" });
  const initialMarks = JSON.stringify({ "s-pub": ["h-pub"], "s-priv": ["h-stale"] });
  const storage = failingStorage({
    initial: {
      [privateKey]: JSON.stringify({ "s-priv": true }),
      [instructionsKey]: initialInstructions,
      [notRelevantKey]: initialMarks
    }
  });
  const client = loadClient({
    storage,
    routes: {
      [`/api/${pluginId}.settings`]: { ok: true, settings: SETTINGS_FIXTURE, version: "1.0.0" }
    }
  });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    const { sessionInstructions, notRelevant } = client.instance.localStore.handles;

    assertEqual(sessionInstructions.memoryRead("s-priv"), "", "private session instruction reads empty from domain memory, never from disk");
    assertEqual(notRelevant.memoryRead("s-priv"), [], "private session marks read empty list from domain memory, never from disk");
    assertEqual(sessionInstructions.memoryRead("s-pub"), undefined, "public session is absent from instruction domain memory");
    assertEqual(notRelevant.memoryRead("s-pub"), undefined, "public session is absent from not-relevant domain memory");

    const instructionEvents = [];
    const markEvents = [];
    sessionInstructions.subscribe((sid) => instructionEvents.push(sid));
    notRelevant.subscribe((sid) => markEvents.push(sid));

    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s-priv",
      callId: "call-1",
      block: {
        kind: "tool-result",
        callId: "call-1",
        name: "suggest_followups",
        turn: 1,
        content: [{ type: "text", text: JSON.stringify({ rev: "sf-2", followups: [{ prompt: "Private card", label: "P" }] }) }]
      }
    });
    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail").component;
    const props = { sessionId: "s-priv", turn: { turn: 1 }, seq: 9, t: (key) => key };

    let tree = renderTail(client, tail, props);
    walk(tree, (node) => node.type === "button" && node.props?.["aria-label"] === "actionNotRelevant")[0].props.onClick();
    assertEqual(storage.setAttemptsByKey.get(notRelevantKey), undefined, "marking in a private session never writes to storage");
    assertEqual(storage.getAttemptsByKey.get(notRelevantKey), undefined, "lazy payload skips reading not-relevant storage in private mode");
    assertEqual(storage._data[notRelevantKey], initialMarks, "global not-relevant storage payload stays untouched");
    const privMarks = notRelevant.memoryRead("s-priv");
    assertEqual(privMarks.length, 1, "domain memory stores the marked hash for the private session");
    assertEqual(markEvents, ["s-priv"], "notRelevant handle notifies once for the private write");

    walk(tree, (node) => node.type === "button" && node.props?.["aria-label"] === "sessionOptions")[0].props.onClick();
    tree = renderTail(client, tail, props);
    const textarea = walk(tree, (node) => node.type === "textarea" && node.props?.["aria-label"] === "sessionInstruction")[0];
    textarea.props.onChange({ target: { value: "  keep in memory  " } });
    assertEqual(storage.setAttemptsByKey.get(instructionsKey), undefined, "writing a private instruction never writes to storage");
    assertEqual(storage.getAttemptsByKey.get(instructionsKey), undefined, "lazy payload skips reading instructions storage in private mode");
    assertEqual(storage._data[instructionsKey], initialInstructions, "global instructions storage payload stays untouched");
    assertEqual(sessionInstructions.memoryRead("s-priv"), "keep in memory", "domain memory stores the trimmed instruction");
    assertEqual(instructionEvents, ["s-priv"], "sessionInstructions handle notifies once for the private write");

    textarea.props.onChange({ target: { value: "   " } });
    assertEqual(sessionInstructions.memoryRead("s-priv"), "", "blanking a private instruction deletes its domain memory entry");
    textarea.props.onChange({ target: { value: "ephemeral rule" } });
    assertEqual(sessionInstructions.memoryRead("s-priv"), "ephemeral rule", "re-populating private memory succeeds");

    const privateLabel = walk(tree, (node) => node.type === "label" && node.children.includes("sessionPrivate"))[0];
    const privateCheckbox = walk(privateLabel, (node) => node.type === "input" && node.props?.type === "checkbox")[0];
    privateCheckbox.props.onChange({ target: { checked: false } });
    assertEqual(sessionInstructions.memoryRead("s-priv"), undefined, "turning private off clears instruction domain memory via memoryDelete");
    assertEqual(notRelevant.memoryRead("s-priv"), undefined, "turning private off clears not-relevant domain memory via memoryDelete");

    const eventsBeforePurge = instructionEvents.length + markEvents.length;
    tree = renderTail(client, tail, props);
    const privateLabelAgain = walk(tree, (node) => node.type === "label" && node.children.includes("sessionPrivate"))[0];
    walk(privateLabelAgain, (node) => node.type === "input" && node.props?.type === "checkbox")[0].props.onChange({ target: { checked: true } });
    assertEqual(JSON.parse(storage._data[instructionsKey]), { "s-pub": "public rule" }, "enabling private purges stale disk instruction for the session while keeping public entries");
    assertEqual(JSON.parse(storage._data[notRelevantKey]), { "s-pub": ["h-pub"] }, "enabling private purges stale disk marks for the session while keeping public entries");
    assertEqual(instructionEvents.length + markEvents.length, eventsBeforePurge, "purge writes omit subscriber notifications");
  } finally {
    client.fetchStub.restore();
  }
});

test("sessionOverrides handle notifies once per write, preserves pending retries on read, and notifies on clearSessionOverride no-op", async () => {
  const overridesKey = `${pluginId}.session-overrides`;
  const storage = failingStorage({
    failSetItemTimes: { [overridesKey]: 1 }
  });
  const client = loadClient({
    storage,
    routes: {
      [`/api/${pluginId}.settings`]: { ok: true, settings: SETTINGS_FIXTURE, version: "1.0.0" },
      [`/api/${pluginId}.generate`]: { ok: true, rev: "sf-2", followups: [{ prompt: "Host card", label: "H" }] }
    }
  });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    const { sessionOverrides } = client.instance.localStore.handles;
    const overrideEvents = [];
    sessionOverrides.subscribe((sid) => overrideEvents.push(sid));

    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s1",
      callId: "generated-1-seed",
      block: {
        kind: "tool-result",
        callId: "generated-1-seed",
        name: "suggest_followups",
        turn: 1,
        content: [{ type: "text", text: JSON.stringify({ rev: "sf-2", followups: [{ prompt: "Seeded card", label: "S" }] }) }]
      }
    });
    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail").component;
    const props = { sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key };

    let tree = renderTail(client, tail, props);
    walk(tree, (node) => node.type === "button" && node.props?.["aria-label"] === "sessionOptions")[0].props.onClick();
    tree = renderTail(client, tail, props);

    walk(tree, (node) => node.type === "button" && node.props?.["aria-label"] === "sessionReset")[0].props.onClick();
    assertEqual(overrideEvents, ["s1"], "clearSessionOverride no-op notifies subscribers once via caller");
    assertEqual(storage.setAttemptsByKey.get(overridesKey), undefined, "clearSessionOverride no-op does not write storage");
    assertEqual(storage.removeAttemptsByKey.get(overridesKey), undefined, "clearSessionOverride no-op does not remove storage");

    tree = renderTail(client, tail, props);
    walk(tree, (node) => node.type === "button" && node.props?.["aria-label"] === "sessionOptions")[0].props.onClick();
    tree = renderTail(client, tail, props);

    const langSelect = walk(tree, (node) => node.type === "select" && node.props?.["aria-label"] === "setLanguage")[0];
    langSelect.props.onChange({ target: { value: "zh-CN" } });
    assertEqual(storage._data[overridesKey], undefined, "first setItem was refused synchronously");
    assertEqual(overrideEvents, ["s1", "s1"], "failed synchronous write still notifies once");

    tree = renderTail(client, tail, props);
    const maxInput = walk(tree, (node) => node.type === "input" && node.props?.["aria-label"] === "setMax")[0];
    maxInput.props.onChange({ target: { value: "2" } });
    assertEqual(
      JSON.parse(storage._data[overridesKey]),
      { s1: { lang: "zh-CN", maxFollowups: 2 } },
      "subsequent override write reads pending state and persists the merged payload"
    );
    assertEqual(overrideEvents, ["s1", "s1", "s1"], "second override write notifies once");
  } finally {
    client.fetchStub.restore();
  }
});

test("clicked handle routes private session clicks to set-items memory without touching storage and persists public clicks", async () => {
  const privateKey = `${pluginId}.private-sessions`;
  const clickedKey = `${pluginId}.clicked`;
  const initialClicked = JSON.stringify({ "sf-existing:0": true });
  const storage = failingStorage({
    initial: {
      [privateKey]: JSON.stringify({ "s-priv": true }),
      [clickedKey]: initialClicked
    }
  });
  const sentPrompts = [];
  const client = loadClient({
    storage,
    routes: {
      [`/api/${pluginId}.settings`]: { ok: true, settings: SETTINGS_FIXTURE, version: "1.0.0" }
    }
  });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    const originalGet = ctx.get;
    ctx.get = (name) => {
      if (name === "sessions") return { binding: (id) => ({ id }) };
      if (name === "conversation") return { binding: () => ({ send: async (text) => { sentPrompts.push(text); } }) };
      return typeof originalGet === "function" ? originalGet(name) : undefined;
    };
    client.instance.apply(ctx);
    const { clicked } = client.instance.localStore.handles;

    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s-priv",
      callId: "call-priv",
      block: {
        kind: "tool-result",
        callId: "call-priv",
        name: "suggest_followups",
        turn: 1,
        content: [{
          type: "text",
          text: JSON.stringify({
            rev: "sf-2",
            followups: [
              { prompt: "Private followup", label: "Priv 1" },
              { prompt: "Second private followup", label: "Priv 2" }
            ]
          })
        }]
      }
    });
    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail").component;
    const privProps = { sessionId: "s-priv", turn: { turn: 1 }, seq: 9, t: (key) => key };

    let privTree = renderTail(client, tail, privProps);
    const privLines = walk(privTree, (node) => typeof node.props?.["data-item-id"] === "string");
    const privItemId = privLines[0].props["data-item-id"];
    const privSecondItemId = privLines[1].props["data-item-id"];
    const privCardBtn = walk(privLines[0], (node) => node.type === "button" && String(node.props?.className ?? "").includes("dsh-sf-card"))[0];
    privCardBtn.props.onClick();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    client.instance.flushWrites();

    assertEqual(sentPrompts, ["Private followup"], "the private card click dispatches the prompt");
    assertEqual(storage.setAttemptsByKey.get(clickedKey), undefined, "private UI send never writes the clicked key to storage");
    assertEqual(storage._data[clickedKey], initialClicked, "existing clicked storage payload stays untouched");
    assertEqual(clicked.memoryRead(privItemId), privItemId, "memoryRead returns the clicked itemId for the private session");
    assertEqual(clicked.memoryRead("missing:0"), undefined, "memoryRead returns undefined for unclicked items");

    let thunkRan = false;
    clicked.enqueue(() => {
      thunkRan = true;
      return "{}";
    }, "s-priv", { memoryValue: privSecondItemId });
    assertEqual(thunkRan, false, "private enqueue routes memoryValue without evaluating the storage thunk");
    assertEqual(clicked.memoryRead(privSecondItemId), privSecondItemId, "memoryRead returns the handle-enqueued private itemId");
    assertEqual(storage.setAttemptsByKey.get(clickedKey), undefined, "direct private enqueue still does not touch storage");

    privTree = renderTail(client, tail, privProps);
    const rerenderedLines = walk(privTree, (node) => typeof node.props?.["data-item-id"] === "string");
    const secondCardBtn = walk(rerenderedLines[1], (node) => node.type === "button" && String(node.props?.className ?? "").includes("dsh-sf-card"))[0];
    assertEqual(secondCardBtn.props.disabled, true, "second private card renders disabled solely from clickedHandle.memoryRead");
    assert(String(secondCardBtn.props.className).includes("is-sent"), "second private card renders is-sent solely from clickedHandle.memoryRead");

    capture.component({
      sessionId: "s-pub",
      callId: "call-pub",
      block: {
        kind: "tool-result",
        callId: "call-pub",
        name: "suggest_followups",
        turn: 1,
        content: [{
          type: "text",
          text: JSON.stringify({
            rev: "sf-2",
            followups: [
              { prompt: "Public first", label: "Pub 1" },
              { prompt: "Public second", label: "Pub 2" }
            ]
          })
        }]
      }
    });
    const pubProps = { sessionId: "s-pub", turn: { turn: 1 }, seq: 9, t: (key) => key };
    const pubTree = renderTail(client, tail, pubProps);
    const pubLines = walk(pubTree, (node) => typeof node.props?.["data-item-id"] === "string");
    const pubItem0 = pubLines[0].props["data-item-id"];
    const pubItem1 = pubLines[1].props["data-item-id"];
    walk(pubLines[0], (node) => node.type === "button" && String(node.props?.className ?? "").includes("dsh-sf-card"))[0].props.onClick();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    walk(pubLines[1], (node) => node.type === "button" && String(node.props?.className ?? "").includes("dsh-sf-card"))[0].props.onClick();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    assertEqual(storage.setAttemptsByKey.get(clickedKey), undefined, "public clicks coalesce in pendingWrites before timer flush");
    client.instance.flushWrites();
    assertEqual(storage.setAttemptsByKey.get(clickedKey), 1, "two public clicks flush in one coalesced storage write");
    assertEqual(
      JSON.parse(storage._data[clickedKey]),
      { "sf-existing:0": true, [pubItem0]: true, [pubItem1]: true },
      "public clicked payload preserves existing and pending clicks"
    );
    assertEqual(clicked.memoryRead(pubItem0), undefined, "public clicks do not populate private set-items memory");
  } finally {
    client.fetchStub.restore();
  }
});

test("privateSessions preserves write failure residue and pausedSessions filters private ids while notifying once", async () => {
  const privateKey = `${pluginId}.private-sessions`;
  const pausedKey = `${pluginId}.paused-sessions`;
  const storage = failingStorage({
    failSetItemTimes: { [privateKey]: 2, [pausedKey]: 1 }
  });
  const client = loadClient({
    storage,
    routes: {
      [`/api/${pluginId}.settings`]: { ok: true, settings: SETTINGS_FIXTURE, version: "1.0.0" }
    }
  });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    const { privateSessions, pausedSessions } = client.instance.localStore.handles;
    const pausedEvents = [];
    pausedSessions.subscribe((sid) => pausedEvents.push(sid));

    assertEqual(
      privateSessions.write(JSON.stringify({ "s-probe": true })),
      false,
      "privateSessions.write returns false when storage.setItem refuses"
    );
    assertEqual(storage._data[privateKey], undefined, "refused direct privateSessions write has not landed in storage");

    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    for (const sid of ["s-priv", "s-pub"]) {
      capture.component({
        sessionId: sid,
        callId: `call-${sid}`,
        block: {
          kind: "tool-result",
          callId: `call-${sid}`,
          name: "suggest_followups",
          turn: 1,
          content: [{ type: "text", text: JSON.stringify({ rev: "sf-2", followups: [{ prompt: `Card ${sid}`, label: sid }] }) }]
        }
      });
    }
    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail").component;
    const privProps = { sessionId: "s-priv", turn: { turn: 1 }, seq: 9, t: (key) => key };
    const pubProps = { sessionId: "s-pub", turn: { turn: 1 }, seq: 9, t: (key) => key };

    let privTree = renderTail(client, tail, privProps);
    walk(privTree, (node) => node.type === "button" && node.props?.["aria-label"] === "sessionOptions")[0].props.onClick();
    privTree = renderTail(client, tail, privProps);
    const privToggleLabel = walk(privTree, (node) => node.type === "label" && node.children.includes("sessionPrivate"))[0];
    walk(privToggleLabel, (node) => node.type === "input" && node.props?.type === "checkbox")[0].props.onChange({ target: { checked: true } });

    privTree = renderTail(client, tail, privProps);
    const residueNotice = walk(privTree, (node) => String(node.props?.className ?? "").includes("dsh-sf-placeholder") && node.children.includes("privatePurgeFailed"))[0];
    assert(residueNotice !== undefined, "refused privateSessions write surfaces the residue warning notice");

    await new Promise((resolve) => setTimeout(resolve, 270));
    client.instance.flushWrites();
    assertEqual(JSON.parse(storage._data[privateKey]), { "s-priv": true }, "retry persists the privateSessions payload");

    let pubTree = renderTail(client, tail, pubProps);
    if (walk(pubTree, (node) => node.type === "label" && node.children.includes("sessionPause")).length === 0) {
      walk(pubTree, (node) => node.type === "button" && node.props?.["aria-label"] === "sessionOptions")[0].props.onClick();
      pubTree = renderTail(client, tail, pubProps);
    }
    const pubPauseLabel = walk(pubTree, (node) => node.type === "label" && node.children.includes("sessionPause"))[0];
    walk(pubPauseLabel, (node) => node.type === "input" && node.props?.type === "checkbox")[0].props.onChange({ target: { checked: true } });

    assertEqual(storage._data[pausedKey], undefined, "first pausedSessions write was refused synchronously");
    assertEqual(pausedEvents, ["s-pub"], "pausedSessions notifies once even when synchronous setItem queues a retry");

    await new Promise((resolve) => setTimeout(resolve, 270));
    client.instance.flushWrites();
    assertEqual(JSON.parse(storage._data[pausedKey]), { "s-pub": true }, "retry persists public paused session");
    assertEqual(pausedEvents, ["s-pub"], "flushing retry does not notify pausedSessions subscribers again");

    privTree = renderTail(client, tail, privProps);
    if (walk(privTree, (node) => node.type === "label" && node.children.includes("sessionPause")).length === 0) {
      walk(privTree, (node) => node.type === "button" && node.props?.["aria-label"] === "sessionOptions")[0].props.onClick();
      privTree = renderTail(client, tail, privProps);
    }
    const privPauseLabel = walk(privTree, (node) => node.type === "label" && node.children.includes("sessionPause"))[0];
    walk(privPauseLabel, (node) => node.type === "input" && node.props?.type === "checkbox")[0].props.onChange({ target: { checked: true } });

    assertEqual(JSON.parse(storage._data[pausedKey]), { "s-pub": true }, "pausedSessions payload omits private session ids");
    assertEqual(pausedEvents, ["s-pub", "s-priv"], "pausing a private session notifies subscribers once with its sessionId");
    privTree = renderTail(client, tail, privProps);
    assertEqual(
      walk(privTree, (node) => node.type === "button" && String(node.props?.className ?? "").includes("dsh-sf-card")).length,
      0,
      "paused private session hides followup cards in memory"
    );

    pubTree = renderTail(client, tail, pubProps);
    if (walk(pubTree, (node) => node.type === "label" && node.children.includes("sessionPause")).length === 0) {
      walk(pubTree, (node) => node.type === "button" && node.props?.["aria-label"] === "sessionOptions")[0].props.onClick();
      pubTree = renderTail(client, tail, pubProps);
    }
    const pubPauseLabelOff = walk(pubTree, (node) => node.type === "label" && node.children.includes("sessionPause"))[0];
    walk(pubPauseLabelOff, (node) => node.type === "input" && node.props?.type === "checkbox")[0].props.onChange({ target: { checked: false } });

    assertEqual(storage._data[pausedKey], undefined, "pausedSessions removes storage key when only private sessions remain paused");
    assertEqual(pausedEvents, ["s-pub", "s-priv", "s-pub"], "unpausing notifies subscribers once");
  } finally {
    client.fetchStub.restore();
  }
});

test("silent clears on audit and discarded remove storage synchronously without notifying subscribers", async () => {
  const auditKey = `${pluginId}.audit.v1`;
  const discardedKey = `${pluginId}.discarded`;
  const seededAudit = JSON.stringify([
    { at: 1000, kind: "generated", hash: "abcdef12", len: 18, sid: "s1hash" }
  ]);
  const seededDiscarded = JSON.stringify({
    "call-1:0": { prompt: "Discarded prompt", label: "Discarded", at: 1500, sessionId: "s1", turn: 1 }
  });
  let failNextRemove = false;
  const storage = failingStorage({
    initial: {
      [auditKey]: seededAudit,
      [discardedKey]: seededDiscarded
    },
    failRemoveItemTimes: () => {
      if (!failNextRemove) return false;
      failNextRemove = false;
      return true;
    }
  });
  const client = loadClient({
    storage,
    routes: {
      [`/api/${pluginId}.settings`]: { ok: true, settings: SETTINGS_FIXTURE, version: "1.0.0" }
    }
  });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    const { audit, discarded } = client.instance.localStore.handles;
    const auditEvents = [];
    const discardedEvents = [];
    audit.subscribe((sid) => auditEvents.push(sid));
    discarded.subscribe((sid) => discardedEvents.push(sid));

    const settings = registrations.find((entry) => entry.spec?.name === "settings.section");
    assert(settings !== undefined, "the settings section is registered");

    let tree = settings.component({ t: (key) => key });
    const auditClearBtn = walk(tree, (node) => node.type === "button" && node.children.includes("auditClear"))[0];
    assert(auditClearBtn !== undefined, "the audit clear button renders when entries exist");
    auditClearBtn.props.onClick();
    tree = settings.component({ t: (key) => key });
    walk(tree, (node) => node.type === "button" && node.children.includes("auditClear"))[0].props.onClick();

    assertEqual(storage._data[auditKey], undefined, "UI clearAudit removes the audit key synchronously before flushWrites");
    assertEqual(auditEvents.length, 0, "UI clearAudit emits zero subscriber notifications");

    tree = settings.component({ t: (key) => key });
    const discardedClearBtn = walk(tree, (node) => node.type === "button" && node.children.includes("discardedClear"))[0];
    assert(discardedClearBtn !== undefined, "the discarded clear button renders when entries exist");
    discardedClearBtn.props.onClick();
    tree = settings.component({ t: (key) => key });
    walk(tree, (node) => node.type === "button" && node.children.includes("discardedClearConfirm"))[0].props.onClick();

    assertEqual(storage._data[discardedKey], undefined, "UI clearDiscarded removes the discarded key synchronously before flushWrites");
    assertEqual(discardedEvents.length, 0, "UI clearDiscarded emits zero subscriber notifications");
    tree = settings.component({ t: (key) => key });
    assert(walk(tree, (node) => node.children.includes("discardedEmpty")).length >= 1, "UI clearDiscarded updates settings state immediately");

    storage._data[discardedKey] = seededDiscarded;
    failNextRemove = true;
    discarded.remove(undefined, { notify: false });
    assertEqual(storage._data[discardedKey], seededDiscarded, "refused removeItem leaves residue until retry flushes");
    assertEqual(discarded.readState(() => ({ stale: true }), {}), {}, "readState returns emptyState while silent remove retry is pending");
    assertEqual(discardedEvents.length, 0, "queued retry for silent remove emits zero notifications");

    await new Promise((resolve) => setTimeout(resolve, 270));
    client.instance.flushWrites();
    assertEqual(storage._data[discardedKey], undefined, "silent remove completes on retry after backoff");
    assertEqual(discardedEvents.length, 0, "flushing silent remove retry emits zero notifications");
  } finally {
    client.fetchStub.restore();
  }
});

test("skip policy handles write nothing for private sessions while discarded still notifies once on discard and undo", async () => {
  const privateKey = `${pluginId}.private-sessions`;
  const favoritesKey = `${pluginId}.favorites`;
  const discardedKey = `${pluginId}.discarded`;
  const cardOrderKey = `${pluginId}.card-order`;
  const collapsedKey = `${pluginId}.collapsed`;
  const auditKey = `${pluginId}.audit.v1`;
  const storage = failingStorage({
    initial: {
      [privateKey]: JSON.stringify({ "s-priv": true })
    }
  });
  const client = loadClient({
    storage,
    routes: {
      [`/api/${pluginId}.settings`]: { ok: true, settings: SETTINGS_FIXTURE, version: "1.0.0" }
    }
  });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    const { favorites, discarded, cardOrder, collapsed, audit } = client.instance.localStore.handles;
    assert(favorites !== undefined && discarded !== undefined && cardOrder !== undefined && collapsed !== undefined && audit !== undefined, "all five group D handles are exposed on localStore.handles");

    const discardedEvents = [];
    discarded.subscribe((sid) => discardedEvents.push(sid));

    const capture = registrations.find((entry) => entry.spec?.name === "tool.call.toolview");
    capture.component({
      sessionId: "s-priv",
      callId: "call-priv-d",
      block: {
        kind: "tool-result",
        callId: "call-priv-d",
        name: "suggest_followups",
        turn: 1,
        content: [{
          type: "text",
          text: JSON.stringify({
            rev: "sf-2",
            followups: [
              { prompt: "Private alpha", label: "Alpha" },
              { prompt: "Private beta", label: "Beta" }
            ]
          })
        }]
      }
    });

    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail").component;
    const props = { sessionId: "s-priv", turn: { turn: 1 }, seq: 9, t: (key) => key };

    let tree = renderTail(client, tail, props);
    const items = walk(tree, (node) => String(node.props?.className ?? "").split(/\s+/).includes("dsh-sf-item"));
    assertEqual(items.length, 2, "both private followup cards render initially");

    const moveEarlier = walk(items[1], (node) => node.type === "button" && node.props?.["aria-label"] === "actionMoveEarlier")[0];
    moveEarlier.props.onClick();
    tree = renderTail(client, tail, props);
    const reorderedCards = walk(tree, (node) => node.type === "button" && String(node.props?.className ?? "").includes("dsh-sf-card"));
    assertEqual(reorderedCards[0].props["aria-label"], "Private beta", "private reorder updates in-memory UI order");

    walk(tree, (node) => node.type === "button" && node.props?.["aria-label"] === "collapseGroup")[0].props.onClick();
    tree = renderTail(client, tail, props);
    assertEqual(walk(tree, (node) => node.type === "button" && String(node.props?.className ?? "").includes("dsh-sf-card")).length, 0, "private collapse hides cards in memory");
    walk(tree, (node) => node.type === "button" && node.props?.["aria-label"] === "expandGroup")[0].props.onClick();
    tree = renderTail(client, tail, props);
    assertEqual(walk(tree, (node) => node.type === "button" && String(node.props?.className ?? "").includes("dsh-sf-card")).length, 2, "private expand restores cards in memory");

    walk(tree, (node) => node.type === "button" && node.props?.["aria-label"] === "actionFavorite")[0].props.onClick();

    assertEqual(discardedEvents.length, 0, "no discarded notifications fired before discard");
    walk(tree, (node) => node.type === "button" && node.props?.["aria-label"] === "actionDiscard")[0].props.onClick();
    assertEqual(discardedEvents, ["s-priv"], "private discard notifies discarded subscribers once with sessionId");

    tree = renderTail(client, tail, props);
    assertEqual(walk(tree, (node) => node.type === "button" && String(node.props?.className ?? "").includes("dsh-sf-card")).length, 1, "private discard removes the card in memory");

    const undoBtn = walk(tree, (node) => node.type === "button" && node.props?.["aria-label"] === "undoDiscard")[0];
    assert(undoBtn !== undefined, "private discard renders the undo button");
    undoBtn.props.onClick();
    assertEqual(discardedEvents, ["s-priv", "s-priv"], "private undoDiscard notifies discarded subscribers once with sessionId");

    tree = renderTail(client, tail, props);
    assertEqual(walk(tree, (node) => node.type === "button" && String(node.props?.className ?? "").includes("dsh-sf-card")).length, 2, "private undoDiscard restores the card in memory");

    let thunkRan = false;
    audit.enqueue(() => {
      thunkRan = true;
      return "[]";
    }, "s-priv");
    assertEqual(thunkRan, false, "private skip policy does not evaluate payload thunks");

    client.instance.flushWrites();
    assertEqual(storage.setAttemptsByKey.get(favoritesKey), undefined, "private toggleFavorite never attempts setItem on favorites");
    assertEqual(storage.setAttemptsByKey.get(discardedKey), undefined, "private discard/undoDiscard never attempts setItem on discarded");
    assertEqual(storage.setAttemptsByKey.get(cardOrderKey), undefined, "private commitOrder never attempts setItem on cardOrder");
    assertEqual(storage.setAttemptsByKey.get(collapsedKey), undefined, "private toggleCollapsed never attempts setItem on collapsed");
    assertEqual(storage.setAttemptsByKey.get(auditKey), undefined, "private recordAudit never attempts setItem on audit");
    assertEqual(storage._data[favoritesKey], undefined, "favorites storage stays empty");
    assertEqual(storage._data[discardedKey], undefined, "discarded storage stays empty");
    assertEqual(storage._data[cardOrderKey], undefined, "cardOrder storage stays empty");
    assertEqual(storage._data[collapsedKey], undefined, "collapsed storage stays empty");
    assertEqual(storage._data[auditKey], undefined, "audit storage stays empty");
  } finally {
    client.fetchStub.restore();
  }
});

test("a failed generation persists the last error record under the plugin key", async () => {
  const storage = memoryStorage();
  const lastErrorKey = `${pluginId}.last-error`;
  const client = loadClient({ storage, routes: {
    [`/api/${pluginId}.settings`]: { ok: true, settings: { ...SETTINGS_FIXTURE, lang: "en" }, version: "1.0.0" },
    [`/api/${pluginId}.generate`]: new Response(JSON.stringify({ error: "no model is selected" }), { status: 400, headers: { "content-type": "application/json" } })
  } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail");
    tail.component({ sessionId: "s1", turn: { turn: 1 }, seq: 9, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 60));
    client.instance.flushWrites();
    const stored = JSON.parse(storage._data[lastErrorKey]);
    assert(typeof stored.message === "string" && stored.message.includes("HTTP 400"), `the failure message is stored: ${stored.message}`);
    assertEqual(stored.timedOut, false, "a plain failure keeps the timeout flag false");
    assert(typeof stored.at === "number", "the record carries its timestamp");
  } finally {
    client.fetchStub.restore();
  }
});

test("a failed generation in a private session persists nothing under the last-error key", async () => {
  const storage = memoryStorage({ [`${pluginId}.private-sessions`]: JSON.stringify({ "s-priv": true }) });
  const client = loadClient({ storage, routes: {
    [`/api/${pluginId}.settings`]: { ok: true, settings: { ...SETTINGS_FIXTURE, lang: "en" }, version: "1.0.0" },
    [`/api/${pluginId}.generate`]: new Response(JSON.stringify({ error: "no model is selected" }), { status: 400, headers: { "content-type": "application/json" } })
  } });
  try {
    const { ctx, registrations } = fakeSlotHost(client.react);
    client.instance.apply(ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const tail = registrations.find((entry) => entry.spec?.name === "conversation.chat.turnTail");
    tail.component({ sessionId: "s-priv", turn: { turn: 1 }, seq: 9, t: (key) => key });
    for (const effect of client.react.__effects ?? []) await effect();
    await new Promise((resolve) => setTimeout(resolve, 60));
    client.instance.flushWrites();
    assertEqual(storage._data[`${pluginId}.last-error`], undefined, "the skip policy keeps the private failure out of storage");
  } finally {
    client.fetchStub.restore();
  }
});
