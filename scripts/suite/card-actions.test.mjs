import { suite, test, assert, assertEqual, pluginId } from "../harness.mjs";
import { loadClient } from "../client-harness.mjs";

const clientInstance = loadClient().instance;
const { createCardActions } = clientInstance.cardActions;
const { buildBody, generationKey, isAbortError } = clientInstance.generationRound;

const ROUTE = `/api/${pluginId}.generate`;
const SESSION_ID = "s1";
const AFTER_SEQ = 40;
const ORDER_KEY = "s1|1";
const ITEM_A = "call-1:0";
const ITEM_B = "call-1:1";
const PROMPT_A = "P1";
const PROMPT_B = "P2 long prompt";

function abortLikeError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function fakeHandle(key, initialState, { memory = false } = {}) {
  let storage = initialState === undefined ? null : JSON.stringify(initialState);
  let pending;
  let memoryValue;
  let reads = 0;
  const subscribers = [];
  const handle = {
    key,
    _enqueued: [],
    get _reads() { return reads; },
    subscribe(listener) {
      subscribers.push(listener);
      return () => {
        const index = subscribers.indexOf(listener);
        if (index !== -1) subscribers.splice(index, 1);
      };
    },
    read() {
      reads += 1;
      return storage;
    },
    readState(readerFn, fallback) {
      reads += 1;
      if (pending !== undefined) {
        if (pending.remove === true) return fallback;
        if (typeof pending.value === "string") {
          try {
            const parsed = JSON.parse(pending.value);
            if (parsed !== null && typeof parsed === "object") return parsed;
          } catch {
            return readerFn();
          }
        }
      }
      return readerFn();
    },
    enqueue(payload, sessionId, options) {
      const next = typeof payload === "function" ? payload() : payload;
      handle._enqueued.push(next === null ? null : String(next));
      pending = next === null ? { remove: true } : { value: String(next) };
      if (options !== undefined && "memoryValue" in options) memoryValue = options.memoryValue;
      for (const listener of [...subscribers]) listener(sessionId);
    },
    write(payload, sessionId, options) {
      handle.enqueue(payload, sessionId, options);
    },
    notify(sessionId) {
      for (const listener of [...subscribers]) listener(sessionId);
    },
    memoryRead(id) {
      return memory ? memoryValue : undefined;
    }
  };
  return handle;
}

function makeModule(options = {}) {
  const timers = [];
  const cancels = [];
  const notices = [];
  const failures = [];
  const refreshed = [];
  const itemUpdates = [];
  const updates = new Map();
  const sent = [];
  const drafts = [];
  const newChats = [];
  const copiedTexts = [];
  const resolveSendCalls = [];
  const clickedCalls = [];
  const audits = [];
  const cardOrders = [];
  const captures = [];
  const lastErrors = [];
  const fetchCalls = [];
  const tracked = [];
  const untracked = [];
  const cancelAllCalls = [];
  const favoritesHandle = fakeHandle(`${pluginId}.favorites`, options.favorites ?? {});
  const discardedHandle = fakeHandle(`${pluginId}.discarded`, options.discarded ?? {});
  const notRelevantHandle = fakeHandle(`${pluginId}.not-relevant`, options.notRelevant ?? {}, { memory: true });

  const trackedMap = new Map();
  const round = {
    track: (key, controller) => {
      tracked.push([key, controller]);
      trackedMap.set(key, [...(trackedMap.get(key) ?? []), controller]);
    },
    untrack: (key, controller) => {
      untracked.push([key, controller]);
      const list = trackedMap.get(key);
      if (list === undefined) return;
      const next = list.filter((entry) => entry !== controller);
      if (next.length === 0) trackedMap.delete(key);
      else trackedMap.set(key, next);
    },
    cancelAll: (sessionId) => {
      cancelAllCalls.push(sessionId);
      const owned = [sessionId + "|", "regen|" + sessionId + "|"];
      for (const key of [...trackedMap.keys()].filter((key) => owned.some((prefix) => key.startsWith(prefix)))) {
        for (const controller of trackedMap.get(key)) {
          if (typeof controller.abort === "function") controller.abort();
        }
        trackedMap.delete(key);
      }
    }
  };

  const deps = {
    sessionId: options.sessionId ?? SESSION_ID,
    afterSeq: "afterSeq" in options ? options.afterSeq : AFTER_SEQ,
    orderKey: "orderKey" in options ? options.orderKey : ORDER_KEY,
    confirmBeforeSend: options.confirmBeforeSend === true,
    updateItem: (itemId, patch) => {
      itemUpdates.push([itemId, patch]);
      updates.set(itemId, { ...(updates.get(itemId) ?? {}), ...patch });
    },
    setNotice: (notice) => notices.push(notice),
    setFailure: (failure) => failures.push(failure),
    refreshStores: (next) => refreshed.push(next),
    resolveSend: options.resolveSend ?? (() => {
      resolveSendCalls.push(true);
      return (text) => {
        sent.push(text);
        return Promise.resolve();
      };
    }),
    composerDraft: options.composerDraft ?? ((text) => drafts.push(text)),
    startSession: options.startSession ?? ((prompt) => newChats.push(prompt)),
    copyText: options.copyText ?? (async (text) => {
      copiedTexts.push(text);
      return true;
    }),
    favoritesHandle,
    discardedHandle,
    notRelevantHandle,
    auditHandle: fakeHandle(`${pluginId}.audit.v1`),
    clickedHandle: fakeHandle(`${pluginId}.clicked`),
    markClicked: (itemId, sessionId) => clickedCalls.push([itemId, sessionId]),
    recordAudit: (kind, text, sessionId) => audits.push([kind, text, sessionId]),
    recordLastError: (key, message, timedOut) => lastErrors.push([key, message, timedOut]),
    writeCardOrder: (key, ids, sessionId) => cardOrders.push([key, ids, sessionId]),
    rememberCapture: (sessionId, callId, turn, followups) => captures.push([sessionId, callId, turn, followups]),
    manualCountFor: options.manualCountFor ?? (() => 0),
    avoidPromptsFor: options.avoidPromptsFor ?? (() => []),
    sessionOverrideOf: options.sessionOverrideOf ?? (() => undefined),
    sessionInstructionOf: options.sessionInstructionOf ?? (() => ""),
    generationAfterSeq: options.generationAfterSeq ?? new Map(),
    buildBody,
    route: ROUTE,
    fetchImpl: options.fetchImpl ?? (async () => ({ ok: true, status: 200, json: async () => ({ followups: [{ prompt: "Regenerated", label: "R" }] }) })),
    round,
    generationKey,
    validateFollowups: options.validateFollowups ?? ((list) => (Array.isArray(list) && list.length > 0 ? list : null)),
    responseJson: async (response) => response.json(),
    isAbortError,
    errorMessage: (error) => (error !== null && typeof error === "object" && typeof error.message === "string" && error.message !== "" ? error.message : String(error)),
    describeError: (error) => String(error?.message ?? error),
    schedule: (fn, ms) => {
      const id = timers.length;
      timers.push({ fn, ms, id, cleared: false, ran: false });
      return id;
    },
    cancel: (id) => {
      const timer = timers[id];
      if (timer !== undefined) {
        timer.cleared = true;
        cancels.push(id);
      }
    },
    confirmResetMs: options.confirmResetMs ?? 4000,
    readCardOrder: options.readCardOrder ?? (() => ({}))
  };

  return {
    actions: createCardActions(deps),
    deps,
    timers,
    cancels,
    notices,
    failures,
    refreshed,
    itemUpdates,
    updates,
    sent,
    drafts,
    newChats,
    copiedTexts,
    resolveSendCalls,
    clickedCalls,
    audits,
    cardOrders,
    captures,
    lastErrors,
    fetchCalls,
    tracked,
    untracked,
    cancelAllCalls,
    favoritesHandle,
    discardedHandle,
    notRelevantHandle
  };
}

async function drain(rounds = 12) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function runTimers() {
  const snapshot = module.timers.filter((timer) => timer.cleared === false && timer.ran === false);
  for (const timer of snapshot) {
    timer.ran = true;
    await timer.fn();
  }
}

let module;

const EMPTY = { uiState: undefined, effect: undefined, notice: undefined };

suite("card actions: the eleven actions produce uiState, effects and notices");

test("copy stores the text, flips the copied flag and resets it by timer", async () => {
  module = makeModule();
  const first = module.actions.dispatch(ITEM_A, "copy", { text: PROMPT_A });
  assertEqual(first, { uiState: undefined, effect: { kind: "copy", text: PROMPT_A }, notice: undefined });
  await drain();
  assertEqual(module.copiedTexts, [PROMPT_A]);
  assertEqual(module.notices.map((notice) => notice.key), ["srCopied"]);
  assertEqual(module.updates.get(ITEM_A), { copied: true });
  assertEqual(module.actions.getState(ITEM_A).copied, true);
  await runTimers();
  assertEqual(module.updates.get(ITEM_A), { copied: false });
  assertEqual(module.timers.every((timer) => timer.cleared === true || timer.ran === true), true);

  module = makeModule({ copyText: async () => false });
  const failed = module.actions.dispatch(ITEM_A, "copy", { text: PROMPT_A });
  await drain();
  assertEqual(module.notices.map((notice) => notice.key), ["copyFailed"]);
  assertEqual(failed.notice, undefined, "a failed copy reports through the bridge only");
  assertEqual(module.actions.getState(ITEM_A), undefined, "a failed copy writes no uiState");
});

test("favorite toggles enqueue the exact store payload and a duplicate is refused", () => {
  module = makeModule();
  const added = module.actions.dispatch(ITEM_A, "favorite", { prompt: PROMPT_A, label: "L" });
  assertEqual(added.effect, { kind: "favorite", favId: added.effect.favId });
  assert(added.effect.favId.length > 0, "the favorite outcome carries the hash id");
  assertEqual(added.notice, { key: "srFavorited" });
  assertEqual(module.refreshed, [{ favorites: module.favoritesHandle.readState(() => ({}), {}), discarded: undefined }]);
  const stored = JSON.parse(module.favoritesHandle._enqueued[0]);
  assertEqual(Object.keys(stored), [added.effect.favId]);
  assertEqual(stored[added.effect.favId].prompt, PROMPT_A);
  assertEqual(stored[added.effect.favId].label, "L");
  assert(typeof stored[added.effect.favId].at === "number");

  module = makeModule({ favorites: { "fav-x": { prompt: PROMPT_A, label: null, at: 1 } } });
  const duplicate = module.actions.dispatch(ITEM_A, "favorite", { prompt: PROMPT_A, label: "L" });
  assertEqual(duplicate.notice, { key: "favoriteDuplicate" });
  assertEqual(module.favoritesHandle._enqueued, [], "a duplicate favorite never enqueues a store write");
  assertEqual(module.refreshed, [], "a duplicate favorite never refreshes the stores view");
});

test("edit, editorDraft, editorCancel and editorConfirm own the editor state", async () => {
  module = makeModule();
  const open = module.actions.dispatch(ITEM_A, "edit", { prompt: PROMPT_A });
  assertEqual(open.uiState, { editing: true, draft: PROMPT_A });
  assertEqual(module.actions.getState(ITEM_A), { editing: true, draft: PROMPT_A });
  const typed = module.actions.dispatch(ITEM_A, "editorDraft", { draft: "  P1 edited  " });
  assertEqual(typed.uiState, { draft: "  P1 edited  " });
  const confirmed = module.actions.dispatch(ITEM_A, "editorConfirm", { prompt: PROMPT_A });
  await drain();
  assertEqual(module.notices, [{ key: "srEdited" }], "the editor confirm announces srEdited through the send flow");
  assertEqual(module.sent, ["P1 edited"]);
  assertEqual(confirmed.uiState, { editing: false, draft: "" });
  assertEqual(confirmed.notice, undefined, "the editor confirm defers its notice to the send flow");
  assertEqual(module.audits, [["sent", "P1 edited", SESSION_ID]]);

  module = makeModule();
  module.actions.dispatch(ITEM_A, "edit", { prompt: PROMPT_A });
  module.actions.dispatch(ITEM_A, "editorDraft", { draft: "   " });
  const blank = module.actions.dispatch(ITEM_A, "editorConfirm", { prompt: PROMPT_A });
  assertEqual(blank, EMPTY);
  assertEqual(module.sent, []);

  module = makeModule();
  module.actions.dispatch(ITEM_A, "edit", { prompt: PROMPT_A });
  module.actions.dispatch(ITEM_A, "editorDraft", { draft: "changed" });
  const cancelled = module.actions.dispatch(ITEM_A, "editorCancel", {});
  assertEqual(cancelled.uiState, { editing: false, draft: "", armed: false, armedText: undefined, armedAnnouncement: undefined });
  assertEqual(module.sent, []);
});

test("editorConfirm with confirmation keeps editing until the armed send confirms", async () => {
  module = makeModule({ confirmBeforeSend: true });
  module.actions.dispatch(ITEM_A, "edit", { prompt: PROMPT_A });
  module.actions.dispatch(ITEM_A, "editorDraft", { draft: "P1 edited" });
  const armed = module.actions.dispatch(ITEM_A, "editorConfirm", { prompt: PROMPT_A });
  assertEqual(armed.notice, { key: "srSendConfirm" });
  assertEqual(armed.effect, { kind: "arm", timerKey: `${ITEM_A}|send`, ms: 4000 });
  assertEqual(module.actions.getState(ITEM_A).editing, true, "the editor stays open while the send is armed");
  assertEqual(module.sent, []);
  assertEqual(module.timers.map((timer) => timer.ms), [4000]);

  const confirmed = module.actions.dispatch(ITEM_A, "editorConfirm", { prompt: PROMPT_A });
  assertEqual(module.cancels, [0], "the armed send timer is cleared on confirm");
  assertEqual(confirmed.uiState.editing, false);
  await drain();
  assertEqual(module.sent, ["P1 edited"]);
  assertEqual(module.notices.at(-1), { key: "srEdited" });
  assertEqual(module.timers.every((timer) => timer.cleared === true || timer.ran === true), true);
});

test("volatile deps are read live: editorConfirm uses the current confirm setting, session and typed draft", async () => {
  module = makeModule({ confirmBeforeSend: false });
  module.actions.dispatch(ITEM_A, "edit", { prompt: PROMPT_A });
  module.actions.dispatch(ITEM_A, "editorDraft", { draft: "  typed live  " });

  module.deps.confirmBeforeSend = true;
  const armed = module.actions.dispatch(ITEM_A, "editorConfirm", { prompt: PROMPT_A });
  assertEqual(armed.notice, { key: "srSendConfirm" }, "the live confirm setting re-arms instead of sending");
  assertEqual(armed.effect, { kind: "arm", timerKey: `${ITEM_A}|send`, ms: 4000 });
  assertEqual(module.sent, [], "nothing is sent while the arm is pending");
  assertEqual(module.actions.getState(ITEM_A).editing, true, "the typed draft is still mirrored");

  module.deps.sessionId = "s-live";
  const confirmed = module.actions.dispatch(ITEM_A, "editorConfirm", { prompt: PROMPT_A });
  assertEqual(confirmed.uiState.editing, false);
  await drain();
  assertEqual(module.sent, ["typed live"], "the typed draft survives the setting change and is trimmed at send time");
  assertEqual(module.audits, [["sent", "typed live", "s-live"]], "the send records the live session");
  assertEqual(module.clickedCalls, [[ITEM_A, "s-live"]]);
  assertEqual(module.resolveSendCalls, [true]);
});

test("the confirm gate reads the live confirmBeforeSend for newChat", () => {
  module = makeModule({ confirmBeforeSend: true });
  module.deps.confirmBeforeSend = false;
  const outcome = module.actions.dispatch(ITEM_A, "newChat", { prompt: PROMPT_A });
  assertEqual(outcome.effect, { kind: "newChat", prompt: PROMPT_A });
  assertEqual(module.timers, [], "the live direct setting skips the arm timer");
  assertEqual(module.newChats, [PROMPT_A], "the chat starts on the first dispatch");
});

test("insert places the draft in the composer and reports insertDraftUnavailable when the draft is unavailable", () => {
  module = makeModule();
  const ok = module.actions.dispatch(ITEM_A, "insert", { text: PROMPT_A });
  assertEqual(module.drafts, [PROMPT_A]);
  assertEqual(ok.notice, { key: "srInserted" });
  assertEqual(ok.effect, { kind: "insert", text: PROMPT_A });
  assertEqual(module.notices.map((notice) => notice.key), ["srInserted"]);

  module = makeModule({ composerDraft: () => { throw new Error("no composer"); } });
  const unavailable = module.actions.dispatch(ITEM_A, "insert", { text: PROMPT_A });
  assertEqual(module.notices.map((notice) => notice.key), ["insertDraftUnavailable"]);
  assertEqual(unavailable.notice, { key: "insertDraftUnavailable" });
  assertEqual(module.actions.getState(ITEM_A), undefined);
});

test("composerDraft failures for a shell without setDraft and a throwing setDraft both report insertDraftUnavailable", () => {
  for (const path of [
    { name: "shell without setDraft", message: "the composer exposes no draft action for this session" },
    { name: "setDraft that throws", message: "the composer refused the draft" }
  ]) {
    module = makeModule({ composerDraft: () => { throw new Error(path.message); } });
    const outcome = module.actions.dispatch(ITEM_A, "insert", { text: PROMPT_A });
    assertEqual(outcome.notice, { key: "insertDraftUnavailable" }, `${path.name} reports insertDraftUnavailable`);
    assertEqual(outcome.effect, { kind: "insert", text: PROMPT_A }, `${path.name} still reports the insert effect`);
    assertEqual(module.notices.map((notice) => notice.key), ["insertDraftUnavailable"], `${path.name} emits exactly one notice`);
    assertEqual(module.drafts, [], `${path.name} never reaches a draft`);
    assertEqual(module.actions.getState(ITEM_A), undefined, `${path.name} writes no uiState`);
  }
});

test("discard enqueues the session entry and undo removes it through the merged pending store", () => {
  module = makeModule();
  const discarded = module.actions.dispatch(ITEM_A, "discard", { prompt: PROMPT_A, label: "L", turn: 1 });
  assertEqual(discarded.notice, { key: "srDiscarded" });
  assertEqual(discarded.effect, { kind: "discard", captureKey: ITEM_A, turn: 1 });
  const entry = JSON.parse(module.discardedHandle._enqueued[0])[ITEM_A];
  assertEqual(entry.prompt, PROMPT_A);
  assertEqual(entry.label, "L");
  assertEqual(entry.sessionId, SESSION_ID);
  assertEqual(entry.turn, 1);
  assert(typeof entry.at === "number");
  assertEqual(module.refreshed[0].discarded[ITEM_A], entry, "the discarded entry lands in the stores view");

  const undo = module.actions.dispatch(ITEM_A, "undo", { captureKey: ITEM_A });
  assertEqual(undo.notice, { key: "srRestored" });
  assertEqual(undo.effect, { kind: "undo", captureKey: ITEM_A });
  assertEqual(module.refreshed.at(-1).discarded[ITEM_A], undefined, "the undo clears the entry from the stores view");
  const afterUndo = JSON.parse(module.discardedHandle._enqueued.at(-1));
  assertEqual(Object.hasOwn(afterUndo, ITEM_A), false, "the coalesced pending store no longer holds the entry");

  const absent = module.actions.dispatch(ITEM_A, "undo", { captureKey: "missing:0" });
  assertEqual(absent, EMPTY);
  assertEqual(module.notices.length, 2, "an absent undo emits no notice");
});

test("notRelevant toggles the marked hash per session in both directions", () => {
  module = makeModule();
  const marked = module.actions.dispatch(ITEM_A, "notRelevant", { prompt: PROMPT_A });
  assertEqual(marked.notice, { key: "notRelevantMarked" });
  assertEqual(marked.effect, { kind: "notRelevant", marked: true });
  assertEqual(module.notRelevantHandle.memoryRead(SESSION_ID).length, 1, "the marked hash reaches the session memory");
  const unmarked = module.actions.dispatch(ITEM_A, "notRelevant", { prompt: PROMPT_A });
  assertEqual(unmarked.notice, { key: "notRelevantUnmarked" });
  assertEqual(unmarked.effect, { kind: "notRelevant", marked: false });
  assertEqual(module.notRelevantHandle.memoryRead(SESSION_ID), [], "the second toggle clears the mark");
});

test("expand flips the expanded flag through the outcome uiState", () => {
  module = makeModule();
  const expanded = module.actions.dispatch(ITEM_A, "expand", {});
  assertEqual(expanded.uiState, { expanded: true });
  assertEqual(expanded.effect, undefined);
  assertEqual(module.actions.getState(ITEM_A).expanded, true);
  const collapsed = module.actions.dispatch(ITEM_A, "expand", {});
  assertEqual(collapsed.uiState, { expanded: false });
  assertEqual(module.actions.getState(ITEM_A).expanded, false);
});

test("moveEarlier, moveLater and the drag move run the same commitOrder pipeline", () => {
  const naturalIds = [ITEM_A, ITEM_B];
  module = makeModule();
  const earlier = module.actions.dispatch(ITEM_B, "moveEarlier", { naturalIds });
  assertEqual(earlier.effect, { kind: "order", ids: [ITEM_B, ITEM_A] });
  assertEqual(earlier.notice, { key: "srReordered" });
  assertEqual(module.cardOrders, [[ORDER_KEY, [ITEM_B, ITEM_A], SESSION_ID]]);

  module = makeModule();
  const later = module.actions.dispatch(ITEM_A, "moveLater", { naturalIds });
  assertEqual(later.effect, { kind: "order", ids: [ITEM_B, ITEM_A] });
  assertEqual(module.cardOrders, [[ORDER_KEY, [ITEM_B, ITEM_A], SESSION_ID]]);

  module = makeModule();
  const dragged = module.actions.dispatch(ITEM_B, "move", { targetId: ITEM_A, before: true, naturalIds });
  assertEqual(dragged.effect, { kind: "order", ids: [ITEM_B, ITEM_A] });
  assertEqual(module.cardOrders, [[ORDER_KEY, [ITEM_B, ITEM_A], SESSION_ID]]);
  assertEqual(module.actions.dispatch(ITEM_B, "move", { targetId: ITEM_B, before: true, naturalIds }), EMPTY, "a drag onto itself is a no-op");

  module = makeModule({ readCardOrder: () => ({ [ORDER_KEY]: [ITEM_B, ITEM_A] }) });
  const ordered = module.actions.dispatch(ITEM_B, "moveLater", { naturalIds });
  assertEqual(ordered.effect, { kind: "order", ids: [ITEM_A, ITEM_B] }, "the stored order seeds the pipeline before the move");
});

test("order actions read the live orderKey and sessionId at action time", () => {
  module = makeModule();
  module.deps.orderKey = "live|order";
  module.deps.sessionId = "s-live";
  const moved = module.actions.dispatch(ITEM_B, "moveEarlier", { naturalIds: [ITEM_A, ITEM_B] });
  assertEqual(moved.effect, { kind: "order", ids: [ITEM_B, ITEM_A] });
  assertEqual(moved.notice, { key: "srReordered" });
  assertEqual(module.cardOrders, [["live|order", [ITEM_B, ITEM_A], "s-live"]], "the order write uses both live values");
});

test("an unknown action id and a missing order key return empty outcomes", () => {
  module = makeModule({ orderKey: undefined });
  assertEqual(module.actions.dispatch(ITEM_A, "nonexistent", {}), EMPTY);
  assertEqual(module.actions.dispatch(ITEM_A, "moveLater", { naturalIds: [ITEM_A, ITEM_B] }), EMPTY);
  assertEqual(module.cardOrders, [], "no order write happens without an order key");
});

suite("card actions: send and newChat arming share one gate with identical timer keys");

test("send without confirmation dispatches immediately and records the sent state", async () => {
  module = makeModule();
  const outcome = module.actions.dispatch(ITEM_A, "send", { text: PROMPT_A, announcement: "srFollowupSent" });
  assertEqual(outcome.effect, { kind: "send", text: PROMPT_A });
  assertEqual(outcome.notice, undefined, "the send notice arrives through the bridge after resolution");
  assertEqual(module.timers, [], "immediate sends never arm a timer");
  await drain();
  assertEqual(module.resolveSendCalls, [true]);
  assertEqual(module.sent, [PROMPT_A]);
  assertEqual(module.clickedCalls, [[ITEM_A, SESSION_ID]]);
  assertEqual(module.audits, [["sent", PROMPT_A, SESSION_ID]]);
  assertEqual(module.updates.get(ITEM_A).sent, true);
  assertEqual(module.notices.at(-1), { key: "srFollowupSent" });
  assertEqual(module.failures, [null]);
});
test("the second send while one is in flight is ignored by the internal guard", async () => {
  let release;
  module = makeModule({
    resolveSend: () => {
      module.resolveSendCalls.push(true);
      return (text) => new Promise((resolve) => { release = resolve; });
    }
  });
  module.actions.dispatch(ITEM_A, "send", { text: PROMPT_A, announcement: "srFollowupSent" });
  await drain();
  module.actions.dispatch(ITEM_B, "send", { text: PROMPT_B, announcement: "srFollowupSent" });
  assertEqual(module.resolveSendCalls.length, 1, "the busy guard blocks the second dispatch");
  release();
  await drain();
  assertEqual(module.clickedCalls.length, 1);
  assertEqual(module.audits.length, 1);
});

test("a synchronous resolveSend failure reports sendFailed and frees the guard", async () => {
  let calls = 0;
  module = makeModule({
    resolveSend: () => {
      calls += 1;
      throw new Error("session services are not available yet");
    }
  });
  module.actions.dispatch(ITEM_A, "send", { text: PROMPT_A, announcement: "srFollowupSent" });
  assertEqual(module.failures, [{ key: "sendFailed", message: "session services are not available yet" }]);
  module.actions.dispatch(ITEM_A, "send", { text: PROMPT_A, announcement: "srFollowupSent" });
  assertEqual(calls, 2, "the guard is released so a retry reaches the port again");
});

test("a rejected send resolves into sendFailed with the port message", async () => {
  module = makeModule({
    resolveSend: () => async () => { throw new Error("the host refused the send"); }
  });
  module.actions.dispatch(ITEM_A, "send", { text: PROMPT_A, announcement: "srFollowupSent" });
  await drain();
  assertEqual(module.failures, [{ key: "sendFailed", message: "the host refused the send" }]);
  assertEqual(module.clickedCalls, [], "a failed send never marks the card clicked");
  assertEqual(module.audits, [], "a failed send never audits");
});

test("armed send resets by its own timer and confirms on the second dispatch", async () => {
  module = makeModule({ confirmBeforeSend: true });
  const armed = module.actions.dispatch(ITEM_A, "send", { text: PROMPT_A, announcement: "srFollowupSent" });
  assertEqual(armed.notice, { key: "srSendConfirm" });
  assertEqual(armed.effect, { kind: "arm", timerKey: `${ITEM_A}|send`, ms: 4000 });
  assertEqual(armed.uiState, { armed: true, armedText: PROMPT_A, armedAnnouncement: "srFollowupSent", chatArmed: false });
  assertEqual(module.timers.map((timer) => timer.ms), [4000]);

  await runTimers();
  assertEqual(module.actions.getState(ITEM_A), { armed: false, armedText: undefined, armedAnnouncement: undefined, chatArmed: false });
  assertEqual(module.cancels, [], "a timer that expired on its own was never cancelled");
  assertEqual(module.sent, [], "an expired arm never sends");

  module.actions.dispatch(ITEM_A, "send", { text: PROMPT_A, announcement: "srFollowupSent" });
  const confirmed = module.actions.dispatch(ITEM_A, "send", { text: PROMPT_A, announcement: "srFollowupSent" });
  assertEqual(confirmed.effect, { kind: "send", text: PROMPT_A });
  assertEqual(confirmed.notice, undefined);
  assertEqual(confirmed.uiState, { armed: false, armedText: undefined, armedAnnouncement: undefined });
  assertEqual(module.cancels, [1], "the pending arm timer is cancelled on confirm");
  assertEqual(module.timers.every((timer) => timer.cleared === true || timer.ran === true), true);
  await drain();
  assertEqual(module.sent, [PROMPT_A]);
  assertEqual(module.updates.get(ITEM_A).sent, true);
});

test("arming a send cancels a pending chat arm and vice versa, with identical timer keys", () => {
  module = makeModule({ confirmBeforeSend: true });
  module.actions.dispatch(ITEM_B, "newChat", { prompt: PROMPT_B });
  assertEqual(module.timers.map((timer) => timer.id), [0], "the chat arm owns timer key chat|B");
  const switched = module.actions.dispatch(ITEM_B, "send", { text: PROMPT_B, announcement: "srFollowupSent" });
  assertEqual(module.cancels, [0], "arming the send clears the pending chat arm");
  assertEqual(module.timers.map((timer) => timer.id), [0, 1], "the send arm takes its own timer");
  assertEqual(switched.uiState.chatArmed, false);
  assertEqual(switched.uiState.armed, true);

  const back = module.actions.dispatch(ITEM_B, "newChat", { prompt: PROMPT_B });
  assertEqual(module.cancels, [0, 1], "arming the chat clears the pending send arm");
  assertEqual(back.uiState.chatArmed, true);
  assertEqual(back.uiState.armed, false);
  assertEqual(back.uiState.armedText, undefined);
  assertEqual(back.uiState.armedAnnouncement, undefined);
});

test("armed newChat confirms into startSession and resets by timer otherwise", async () => {
  module = makeModule({ confirmBeforeSend: true });
  module.actions.dispatch(ITEM_A, "newChat", { prompt: PROMPT_A });
  await runTimers();
  assertEqual(module.actions.getState(ITEM_A).chatArmed, false);
  assertEqual(module.newChats, []);

  module.actions.dispatch(ITEM_A, "newChat", { prompt: PROMPT_A });
  const confirmed = module.actions.dispatch(ITEM_A, "newChat", { prompt: PROMPT_A });
  assertEqual(confirmed.effect, { kind: "newChat", prompt: PROMPT_A });
  assertEqual(module.newChats, [PROMPT_A]);
  assertEqual(module.cancels, [1], "only the second chat arm timer was cancelled; the first expired");
  assertEqual(module.timers.every((timer) => timer.cleared === true || timer.ran === true), true);
});

test("the confirm-area cancel clears both arms in one outcome", () => {
  module = makeModule({ confirmBeforeSend: true });
  module.actions.dispatch(ITEM_A, "send", { text: PROMPT_A, announcement: "srFollowupSent" });
  const cancelled = module.actions.dispatch(ITEM_A, "cancelArm", {});
  assertEqual(module.cancels, [0], "the send arm timer is cancelled");
  assertEqual(cancelled.uiState, { armed: false, armedText: undefined, armedAnnouncement: undefined, chatArmed: false });
  module.actions.dispatch(ITEM_B, "newChat", { prompt: PROMPT_B });
  module.actions.dispatch(ITEM_B, "cancelArm", {});
  assertEqual(module.cancels, [0, 1], "the chat arm timer is cancelled too");
  assertEqual(module.sent, [], "a cancelled arm never sends");
  assertEqual(module.newChats, [], "a cancelled arm never opens a conversation");
});

test("newChat unavailability reports the notice", () => {
  module = makeModule({ startSession: () => { throw new Error("no workspace"); } });
  const outcome = module.actions.dispatch(ITEM_A, "newChat", { prompt: PROMPT_A });
  assertEqual(outcome.effect, { kind: "newChat", prompt: PROMPT_A });
  assertEqual(module.notices.map((notice) => notice.key), ["newChatUnavailable"]);
  assertEqual(module.newChats, []);
});

test("dispose cancels every timer, cancels the session round and purges the regen state", async () => {
  let settle;
  const fetchImpl = (url, init) => {
    module.fetchCalls.push({ url, body: init.body, signal: init.signal });
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(abortLikeError("The operation was aborted.")));
      settle = resolve;
    });
  };
  module = makeModule({ confirmBeforeSend: true, fetchImpl, generationAfterSeq: new Map([[generationKey(SESSION_ID, 1), 41]]) });
  module.actions.dispatch(ITEM_A, "send", { text: PROMPT_A, announcement: "srFollowupSent" });
  module.actions.dispatch(ITEM_B, "newChat", { prompt: PROMPT_B });
  module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: { turn: 1 } });
  assertEqual(module.timers.length, 2, "two arm timers are live");
  assertEqual(module.tracked.length, 1, "the regenerate controller is tracked");
  assertEqual(module.fetchCalls.length, 1, "the regenerate request is already in flight");

  module.actions.dispose();
  assertEqual(module.cancels, [0, 1], "every live timer is cancelled");
  assertEqual(module.timers.every((timer) => timer.cleared === true), true);
  assertEqual(module.cancelAllCalls, [SESSION_ID]);
  assertEqual(module.fetchCalls[0].signal.aborted, true, "dispose aborts the live regen controller");
  await drain();
  assertEqual(module.failures, [], "the aborted stale round is silent");
  assertEqual(module.captures, [], "the aborted stale round never captures");

  module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: { turn: 1 } });
  assertEqual(module.fetchCalls.length, 2, "dispose purged the regen guard, so a fresh regenerate is allowed");
  assertEqual(module.tracked.length, 2, "the fresh controller joins the registry");
  assertEqual(module.fetchCalls[1].signal.aborted, false, "the fresh request is live");

  settle({ ok: true, status: 200, json: async () => ({ followups: [{ prompt: "R", label: "L" }] }) });
  await drain();
  assertEqual(module.captures, [[SESSION_ID, "manual-1-0", 1, [{ prompt: "R", label: "L" }]]]);
  assertEqual(module.notices.at(-1), { key: "srRegenerated" });
  assertEqual(module.untracked, module.tracked, "every tracked controller is untracked in the end");
});

suite("card actions: keyboard routes through the same outcomes with its guards");

function keyEvent(key, overrides = {}) {
  return {
    key,
    target: { tagName: "BUTTON" },
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    prevented: false,
    preventDefault() { this.prevented = true; },
    ...overrides
  };
}

test("c, f, e, i and d dispatch their actions and prevent the default", async () => {
  module = makeModule();
  const context = { prompt: PROMPT_A, label: "L", entry: { turn: 1 } };
  const dispatched = [];
  const press = (key, overrides = {}) => {
    const event = keyEvent(key, overrides);
    dispatched.push(event);
    return module.actions.key(event, ITEM_A, context);
  };
  const copyOutcome = press("c");
  assertEqual(copyOutcome.effect, { kind: "copy", text: PROMPT_A });
  await drain();
  assertEqual(module.copiedTexts, [PROMPT_A]);

  const favOutcome = press("F");
  assertEqual(favOutcome.effect.kind, "favorite");
  assertEqual(module.favoritesHandle._enqueued.length, 1);

  const editOutcome = press("e");
  assertEqual(editOutcome.uiState, { editing: true, draft: PROMPT_A });

  const insertOutcome = press("i");
  assertEqual(insertOutcome.notice, { key: "srInserted" });
  assertEqual(module.drafts, [PROMPT_A]);

  const discardOutcome = press("d");
  assertEqual(discardOutcome.effect, { kind: "discard", captureKey: ITEM_A, turn: 1 });
  assertEqual(module.discardedHandle._enqueued.length, 1);

  for (const event of dispatched) {
    assert(event.prevented === true, `${event.key} prevents the browser default`);
  }
});

test("Escape closes the editor first and the expansion second", () => {
  module = makeModule();
  module.actions.dispatch(ITEM_A, "edit", { prompt: PROMPT_A });
  const editorEscape = module.actions.key(keyEvent("Escape"), ITEM_A, { prompt: PROMPT_A });
  assertEqual(editorEscape.uiState, { editing: false, draft: "" });

  module.actions.dispatch(ITEM_A, "expand", {});
  const expandedEscape = module.actions.key(keyEvent("Escape"), ITEM_A, { prompt: PROMPT_A });
  assertEqual(expandedEscape.uiState, { expanded: false });

  const idleEscape = module.actions.key(keyEvent("Escape"), ITEM_A, { prompt: PROMPT_A });
  assertEqual(idleEscape, EMPTY);
});

test("modifier keys, form targets and default-prevented events fall through untouched", () => {
  module = makeModule();
  const context = { prompt: PROMPT_A, label: "L", entry: { turn: 1 } };
  for (const overrides of [
    { key: "d", ctrlKey: true },
    { key: "d", metaKey: true },
    { key: "d", altKey: true },
    { key: "d", shiftKey: true },
    { key: "d", target: { tagName: "TEXTAREA" } },
    { key: "d", target: { tagName: "INPUT" } },
    { key: "d", target: { tagName: "SELECT" } },
    { key: "d", defaultPrevented: true },
    { key: "" },
    { key: "x" }
  ]) {
    assertEqual(module.actions.key(keyEvent("d", overrides), ITEM_A, context), EMPTY, `the ${overrides.key ?? "d"} guard falls through`);
  }
  assertEqual(module.discardedHandle._enqueued, [], "no guarded event reaches an action");
  assertEqual(module.actions.key(null, ITEM_A, context), EMPTY, "a missing event is ignored");
});

suite("card actions: the regenerate contract keeps discard-before-request and single-shot semantics");

function regenModule(options = {}) {
  return makeModule({
    ...options,
    generationAfterSeq: options.generationAfterSeq ?? new Map([[generationKey(SESSION_ID, 1), 41]]),
    sessionOverrideOf: options.sessionOverrideOf ?? (() => ({ lang: "pt-BR", model: "demo/x" })),
    sessionInstructionOf: options.sessionInstructionOf ?? (() => "foco"),
    avoidPromptsFor: options.avoidPromptsFor ?? (() => ["clicked one", PROMPT_A])
  });
}

test("the regenerate body goes through buildBody with maxFollowups 1 and the prompt-purged avoid list", async () => {
  module = regenModule();
  const fetchImpl = module.deps.fetchImpl;
  module.deps.fetchImpl = async (url, init) => {
    const call = {
      url,
      body: init.body,
      signal: init.signal,
      discardedBefore: module.discardedHandle._enqueued.length > 0,
      trackedBefore: module.tracked.length > 0
    };
    module.fetchCalls.push(call);
    return { ok: true, status: 200, json: async () => ({ followups: [{ prompt: "Regenerated", label: "R" }] }) };
  };
  const outcome = module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: { turn: 1 } });
  assertEqual(outcome.notice, { key: "regenerating" });
  assertEqual(outcome.uiState, { regenerating: true });
  assertEqual(module.notices[0].key, "regenerating");
  assertEqual(module.fetchCalls.length, 1, "the request leaves immediately");
  assertEqual(module.fetchCalls[0].url, ROUTE);
  assertEqual(module.fetchCalls[0].discardedBefore, true, "the discard effect lands before the request");
  assertEqual(module.fetchCalls[0].trackedBefore, true, "the controller is tracked before the request");
  assertEqual(module.discardedHandle._enqueued.length, 1, "the discard is the same capture-key entry");
  assertEqual(
    JSON.parse(module.fetchCalls[0].body),
    buildBody({
      variant: "generate",
      sessionId: SESSION_ID,
      afterSeq: 41,
      maxFollowups: 1,
      lang: "pt-BR",
      model: "demo/x",
      customInstruction: "foco",
      avoid: [PROMPT_A, "clicked one"]
    })
  );
  assert(module.fetchCalls[0].signal instanceof AbortSignal, "the request carries the single-shot abort signal");
  await drain();
  assertEqual(module.captures, [[SESSION_ID, "manual-1-0", 1, [{ prompt: "Regenerated", label: "R" }]]]);
  assertEqual(module.notices.at(-1), { key: "srRegenerated" });
  assertEqual(module.failures, [null]);
  assertEqual(module.lastErrors, [], "a success never records a last error");
  assertEqual(module.untracked, module.tracked, "the regen controller is untracked after the round");
  assertEqual(module.updates.get(ITEM_A).regenerating, false);
  assertEqual(module.actions.getState(ITEM_A).regenerating, false);
});

test("the manual capture call id counts the turn with manualCountFor", async () => {
  module = regenModule({ manualCountFor: () => 2 });
  module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: { turn: 1 } });
  await drain();
  assertEqual(module.captures[0][1], "manual-1-2");
});

test("regenerate reads the live sessionId and afterSeq at action time", async () => {
  module = regenModule();
  module.deps.fetchImpl = async (url, init) => {
    module.fetchCalls.push({ url, body: init.body, signal: init.signal });
    return { ok: true, status: 200, json: async () => ({ followups: [{ prompt: "Regenerated", label: "R" }] }) };
  };
  module.deps.sessionId = "s-live";
  module.deps.afterSeq = 99;
  module.deps.generationAfterSeq = new Map([[generationKey("s-live", 1), 101]]);
  module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: { turn: 1 } });
  await drain();
  const body = JSON.parse(module.fetchCalls[0].body);
  assertEqual(body.sessionId, "s-live", "the request body carries the live session");
  assertEqual(body.afterSeq, 101, "the live generationAfterSeq decides the seq");
  assertEqual(module.tracked[0][0], "regen|s-live|1", "the single-flight guard uses the live session");
  assertEqual(module.captures[0][0], "s-live");
  assertEqual(module.captures[0][1], "manual-1-0");

  module.deps.generationAfterSeq = new Map();
  module.deps.afterSeq = 77;
  module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: { turn: 1 } });
  await drain();
  assertEqual(JSON.parse(module.fetchCalls[1].body).afterSeq, 77, "the live afterSeq is the fallback when no seq is known");
});

test("a missing turn or afterSeq refuses the regenerate before any effect", () => {
  module = regenModule();
  assertEqual(module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: {} }), EMPTY);
  assertEqual(module.fetchCalls, []);
  assertEqual(module.discardedHandle._enqueued, []);

  module = regenModule({ afterSeq: undefined });
  assertEqual(module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: { turn: 1 } }), EMPTY);
  assertEqual(module.fetchCalls, []);
});

test("a non-abort failure reports generationFailed and records the last error as non-timeout", async () => {
  module = regenModule();
  module.deps.fetchImpl = async () => ({ ok: false, status: 502, json: async () => ({ error: "upstream exploded" }) });
  module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: { turn: 1 } });
  await drain();
  assertEqual(module.failures, [{ key: "generationFailed", message: "the generator answered with HTTP 502: upstream exploded" }]);
  assertEqual(module.lastErrors, [[`${SESSION_ID}|1`, "the generator answered with HTTP 502: upstream exploded", false]]);
  assertEqual(module.captures, [], "a failure never captures a manual entry");
  assertEqual(module.updates.get(ITEM_A).regenerating, false);
});

test("an abort is silent: no failure state and no last error record", async () => {
  module = regenModule();
  module.deps.fetchImpl = async () => { throw abortLikeError("The operation was aborted."); };
  module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: { turn: 1 } });
  await drain();
  assertEqual(module.failures, [], "an abort never reaches the failure sink");
  assertEqual(module.lastErrors, []);
  assertEqual(module.captures, []);
  assertEqual(module.updates.get(ITEM_A).regenerating, false);
});

test("a duplicate regenerate is refused while the first round is in flight", async () => {
  let resolveFirst;
  module = regenModule({ fetchImpl: () => new Promise((resolve) => { resolveFirst = resolve; }) });
  const first = module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: { turn: 1 } });
  assertEqual(first.uiState, { regenerating: true });
  const duplicate = module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: { turn: 1 } });
  assertEqual(duplicate, EMPTY);
  assertEqual(module.discardedHandle._enqueued.length, 1, "the duplicate adds no second discard");
  resolveFirst({ ok: true, status: 200, json: async () => ({ followups: [{ prompt: "R", label: "L" }] }) });
  await drain();
  module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: { turn: 1 } });
  assertEqual(module.discardedHandle._enqueued.length, 2, "after the round settles a new regenerate discards again");
  await drain();
});

test("an invalid generator answer records the failure without capturing", async () => {
  module = regenModule({ validateFollowups: () => null });
  module.deps.fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ followups: [] }) });
  module.actions.dispatch(ITEM_A, "regenerate", { prompt: PROMPT_A, label: "L", entry: { turn: 1 } });
  await drain();
  assertEqual(module.failures, [{ key: "generationFailed", message: "the generator answered without suggestions" }]);
  assertEqual(module.lastErrors, [[`${SESSION_ID}|1`, "the generator answered without suggestions", false]]);
});

suite("card actions: the mirror exposes state and notifies listeners");

test("subscribe receives every item patch and unsubscribe stops the stream", () => {
  module = makeModule();
  const events = [];
  const unsubscribe = module.actions.subscribe((event) => events.push(event));
  module.actions.dispatch(ITEM_A, "edit", { prompt: PROMPT_A });
  module.actions.dispatch(ITEM_A, "expand", {});
  assertEqual(events.map((event) => event.itemId), [ITEM_A, ITEM_A]);
  assertEqual(events[0].patch, { editing: true, draft: PROMPT_A });
  assertEqual(events[1].patch, { expanded: true });
  unsubscribe();
  module.actions.dispatch(ITEM_A, "expand", {});
  assertEqual(events.length, 2, "an unsubscribed listener receives no further patches");
});

test("getState re-syncs the mirror while unknown items read undefined", () => {
  module = makeModule();
  assertEqual(module.actions.getState(ITEM_A), undefined);
  module.actions.dispatch(ITEM_B, "expand", {});
  assertEqual(module.actions.getState(ITEM_B), { expanded: true });
  assertEqual(module.actions.getState("missing:0"), undefined);
});

test("construction performs no storage reads; discard reads discarded state fresh at action time", () => {
  module = makeModule();
  assertEqual(module.favoritesHandle._reads, 0, "favorites are never read during construction");
  assertEqual(module.discardedHandle._reads, 0, "discarded state is not snapshotted during construction");
  assertEqual(module.notRelevantHandle._reads, 0, "not-relevant state is not read during construction");

  module.actions.dispatch(ITEM_A, "discard", { prompt: PROMPT_A, label: "L", turn: 1 });
  assert(module.discardedHandle._reads >= 2, "the discard action reads the live discarded state");
});
