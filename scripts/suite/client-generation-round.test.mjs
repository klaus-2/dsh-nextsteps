import { suite, test, assert, assertEqual } from "../harness.mjs";
import { loadClient } from "../client-harness.mjs";

const { PROBE_TIMEOUT_MS, buildBody, createGenerationRound, generationKey, isAbortError } = loadClient().instance.generationRound;

const ROUTE = "/api/dsh-nextsteps.generate";

function fakeTime() {
  const timers = [];
  const timeoutCalls = [];
  return {
    timers,
    timeoutCalls,
    now: () => 1000,
    setTimeout: (fn, ms) => {
      const id = timers.length;
      timers.push({ fn, ms, cleared: false });
      return id;
    },
    clearTimeout: (id) => {
      const timer = timers[id];
      if (timer !== undefined) timer.cleared = true;
    },
    timeoutSignal: (ms) => { timeoutCalls.push(ms); return AbortSignal.timeout(ms); },
    controller: () => new AbortController(),
    wait: async () => {}
  };
}

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function makeRound(options = {}) {
  const time = options.time ?? fakeTime();
  const calls = [];
  const hooks = {
    onStart: () => {},
    onFinish: () => {},
    onSuccess: () => {},
    onFailure: () => {},
    onMetric: () => {},
    getRevision: () => 0,
    contextOf: () => ({}),
    ...(options.hooks ?? {})
  };
  const round = createGenerationRound({
    time,
    fetchImpl: options.fetchImpl ?? (async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return response(200, { followups: [{ prompt: "p", label: "L" }], model: "m/x", source: "transcript" });
    }),
    responseJson: async (candidate) => candidate.json(),
    routeOf: () => ROUTE,
    validateFollowups: options.validateFollowups ?? ((list) => (Array.isArray(list) && list.length > 0 ? list : null)),
    describeError: (error) => String(error?.message ?? error),
    constants: {
      attempts: 2,
      retryDelayMs: 1,
      latencyMinMs: 5000,
      latencyMaxMs: 120000,
      latencyDefaultMs: 60000,
      deadlineSlackMs: 5000,
      ...(options.constants ?? {})
    },
    hooks
  });
  return { round, time, calls, hooks };
}

suite("client generation round: the discriminated body builder (module equivalent of the body pins)");

test("the module exports the frozen probe timeout", () => {
  assertEqual(PROBE_TIMEOUT_MS, 5000, "the probe timeout stays at five seconds");
});

test("the probe body has exactly the three pinned fields", () => {
  assertEqual(
    buildBody({ variant: "probe", sessionId: "s1", afterSeq: 9 }),
    { sessionId: "s1", afterSeq: 9, validate: true }
  );
});

test("the generate body carries every optional field when each is present", () => {
  assertEqual(
    buildBody({
      variant: "generate",
      sessionId: "s1",
      afterSeq: 9,
      lang: "pt-BR",
      maxFollowups: 2,
      model: "demo/model",
      customInstruction: "foco",
      avoid: ["clicked"]
    }),
    {
      sessionId: "s1",
      afterSeq: 9,
      lang: "pt-BR",
      maxFollowups: 2,
      model: "demo/model",
      customInstruction: "foco",
      avoid: ["clicked"]
    }
  );
});

test("the generate body omits an empty avoid list and every absent optional (pin :4814)", () => {
  const body = buildBody({ variant: "generate", sessionId: "s1", afterSeq: 9, avoid: [] });
  assertEqual(body, { sessionId: "s1", afterSeq: 9 }, "only the base fields survive");
  assert(body.avoid === undefined, "the avoid key is absent, not undefined-valued");
  assert(Object.hasOwn(body, "lang") === false, "no lang key");
  assert(Object.hasOwn(body, "model") === false, "no model key");
});

test("an unknown body variant is rejected, not silently defaulted", () => {
  let threw = false;
  try {
    buildBody({ variant: "other", sessionId: "s1", afterSeq: 9 });
  } catch (error) {
    threw = error instanceof Error && error.message.includes("unknown generation body variant");
  }
  assert(threw, "the discriminated builder refuses an unknown variant");
});

suite("client generation round: probe, controller and failure sinks");

test("generationKey and isAbortError are owned by the module", () => {
  assertEqual(generationKey("s1", 9), "s1|9", "the key format is unchanged");
  assert(isAbortError(Object.assign(new Error("x"), { name: "AbortError" })), "an AbortError is recognised");
  assert(isAbortError({ code: "ABORT_ERR" }), "an ABORT_ERR is recognised");
  assert(isAbortError(new Error("no model")) === false, "a configuration error is not an abort");
});

test("the probe sends the probe shape with the bounded signal and reads completed", async () => {
  const signals = [];
  const { round, time } = makeRound({
    fetchImpl: async (url, init) => {
      signals.push({ url, init });
      return response(200, { completed: true });
    }
  });
  assertEqual(await round.probe("s1", 9), true, "a completed turn validates true");
  assertEqual(signals.length, 1, "the probe is a single call");
  assertEqual(signals[0].url, ROUTE, "the probe reaches the generate route");
  assertEqual(signals[0].init.body, '{"sessionId":"s1","afterSeq":9,"validate":true}', "the probe body is the pinned shape");
  assert(signals[0].init.signal instanceof AbortSignal, "the probe carries an abort signal");
  assertEqual(time.timeoutCalls, [5000], "the probe uses the frozen five-second timeout");
});

test("a failing probe is a false boolean with no retry and no throw", async () => {
  let calls = 0;
  const { round } = makeRound({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("the host is down");
    }
  });
  assertEqual(await round.probe("s1", 9), false, "the failure is swallowed into false");
  assertEqual(calls, 1, "the probe never retries");
});

test("a successful round warns nothing, reports the origin and frees its slot", async () => {
  const events = [];
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const { round, calls, time } = makeRound({
      hooks: {
        onStart: (sessionId) => events.push(["start", sessionId]),
        onFinish: (sessionId) => events.push(["finish", sessionId]),
        onSuccess: (sessionId, turn, followups, origin) => events.push(["success", sessionId, turn, followups, origin]),
        onFailure: (key, message) => events.push(["failure", key, message]),
        onMetric: (ms) => events.push(["metric", ms])
      }
    });
    await round.start("s1", 9, 9, 60000);
    assertEqual(calls.length, 1, "one HTTP attempt is enough");
    assertEqual(warnings.filter((line) => line.includes("generation failed")).length, 0, "a success warns nothing");
    assertEqual(calls[0].body, { sessionId: "s1", afterSeq: 9 }, "the generate body is the base shape");
    assertEqual(time.timers.map((timer) => timer.ms), [65000], "the deadline is the clamped budget plus slack");
    assertEqual(events[0], ["start", "s1"], "the round announces its start");
    assertEqual(events.at(-1), ["finish", "s1"], "the round announces its finish");
    assertEqual(events.find((entry) => entry[0] === "failure"), undefined, "no failure is reported");
    const success = events.find((entry) => entry[0] === "success");
    assert(success !== undefined && success[4].model === "m/x" && success[4].source === "transcript", "the origin reaches the caller");
    assertEqual(round.has(generationKey("s1", 9)), false, "the slot is free after success");
  } finally {
    console.warn = originalWarn;
  }
});

test("a retryable failure keeps exactly two HTTP attempts and one warning", async () => {
  const failures = [];
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    let calls = 0;
    const { round } = makeRound({
      fetchImpl: async () => {
        calls += 1;
        return response(502, { error: "upstream exploded" });
      },
      hooks: {
        onFailure: (key, message, timedOut) => failures.push([key, message, timedOut])
      }
    });
    await round.start("s1", 9, 9, 60000);
    assertEqual(calls, 2, "the existing two attempts are preserved, not extended");
    assertEqual(failures.length, 1, "the failure sink fires once per round");
    assert(failures[0][1].includes("HTTP 502: upstream exploded"), "the host detail is kept");
    assertEqual(warnings.filter((line) => line.includes("generation failed")).length, 1, "the generation sink warns once");
  } finally {
    console.warn = originalWarn;
  }
});

test("repeated failures on one turn warn once but still report each failure", async () => {
  const originalWarn = console.warn;
  const warnings = [];
  const failures = [];
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const { round } = makeRound({
      fetchImpl: async () => response(502, { error: "upstream exploded" }),
      hooks: { onFailure: (key, message) => failures.push([key, message]) }
    });
    await round.start("s1", 9, 9, 60000);
    await round.start("s1", 9, 9, 60000);
    assertEqual(failures.length, 2, "each round still reports its failure");
    assertEqual(warnings.filter((line) => line.includes("generation failed")).length, 1, "the same turn warns once");
  } finally {
    console.warn = originalWarn;
  }
});

test("a settings change during a round drops the stale answer and frees the slot", async () => {
  let revision = 0;
  const successes = [];
  const { round } = makeRound({
    fetchImpl: async () => {
      revision = 1;
      return response(200, { followups: [{ prompt: "p" }], model: "m/x", source: "transcript" });
    },
    hooks: { getRevision: () => revision, onSuccess: () => successes.push(true) }
  });
  await round.start("s1", 9, 9, 60000);
  assertEqual(successes.length, 0, "a stale answer is never delivered");
  assertEqual(round.has(generationKey("s1", 9)), false, "the slot is free after the stale answer");
});

test("a 409 is silent: one attempt, no warning, no failure state", async () => {
  let calls = 0;
  const failures = [];
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const { round } = makeRound({
      fetchImpl: async () => {
        calls += 1;
        return response(409, { error: "the chat moved on" });
      },
      hooks: { onFailure: (key, message) => failures.push([key, message]) }
    });
    await round.start("s1", 9, 9, 60000);
    assertEqual(calls, 1, "a conflict ends the round without retry");
    assertEqual(failures.length, 0, "a conflict is not exposed as a failure");
    assertEqual(warnings.length, 0, "a conflict warns nothing");
    assertEqual(round.has(generationKey("s1", 9)), false, "the slot is free after a conflict");
  } finally {
    console.warn = originalWarn;
  }
});

test("a non-retryable 400 stops after one attempt and still reaches both sinks", async () => {
  let calls = 0;
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const { round } = makeRound({
      fetchImpl: async () => {
        calls += 1;
        return response(400, { error: "no model is selected" });
      }
    });
    await round.start("s1", 9, 9, 60000);
    assertEqual(calls, 1, "a configuration error is not retried");
    assertEqual(warnings.filter((line) => line.includes("generation failed")).length, 1, "the failure still warns");
  } finally {
    console.warn = originalWarn;
  }
});

test("cancel aborts the in-flight signal and leaves no warning", async () => {
  const signals = [];
  const failures = [];
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  try {
    const { round } = makeRound({
      fetchImpl: (url, init) => {
        signals.push(init.signal);
        return new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          });
        });
      },
      hooks: { onFailure: (key, message) => failures.push([key, message]) }
    });
    const pending = round.start("s1", 9, 9, 60000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(signals.length === 1 && signals[0].aborted === false, "the request is live before cancel");
    round.cancel(generationKey("s1", 9));
    await pending;
    assertEqual(signals[0].aborted, true, "cancel aborts the live request");
    assertEqual(failures.length, 0, "a cancel is not a failure");
    assertEqual(warnings.length, 0, "a cancel warns nothing");
    assertEqual(round.has(generationKey("s1", 9)), false, "the slot is free after cancel");
  } finally {
    console.warn = originalWarn;
  }
});

test("a caller-tracked controller is aborted by cancelAll for that session only", () => {
  const { round } = makeRound();
  const key = generationKey("s1", 9);
  const controller = new AbortController();
  const other = new AbortController();
  round.track(key, controller);
  round.track(generationKey("s2", 9), other);
  round.cancelAll("s1");
  assertEqual(controller.signal.aborted, true, "the session's tracked controller is aborted");
  assertEqual(other.signal.aborted, false, "another session is untouched");
  round.track(key, controller);
  round.untrack(key, controller);
  const replacement = new AbortController();
  round.track(key, replacement);
  round.cancelAll("s1");
  assertEqual(replacement.signal.aborted, true, "untrack leaves the registry usable");
});

suite("client generation round: start / probe / regen / cancel / unmount own every in-flight round");

test("start, probe, regen, cancel and unmount leave zero live controllers", async () => {
  const signals = new Map();
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.validate === true) return response(200, { completed: true });
    signals.set(generationKey(body.sessionId, body.afterSeq), init.signal);
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        reject(error);
      });
    });
  };
  const { round } = makeRound({ fetchImpl });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const started = round.start("s1", 9, 9, 60000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEqual(round.liveCount("s1"), 1, "start: one live generation controller");
    assertEqual(signals.get(generationKey("s1", 9))?.aborted, false, "start: the request is live");

    assertEqual(await round.probe("s1", 10), true, "probe: completes without a retry");
    assertEqual(round.liveCount("s1"), 1, "probe: no controller is retained");

    const regenController = new AbortController();
    round.track('regen|' + generationKey("s1", 9), regenController);
    assertEqual(round.liveCount("s1"), 2, "regen: the caller-owned controller joins the registry");
    assertEqual(regenController.signal.aborted, false, "regen: stays caller-initiated and live");

    const otherController = new AbortController();
    round.track(generationKey("s1", 11), otherController);
    round.cancel(generationKey("s1", 11));
    assertEqual(otherController.signal.aborted, true, "cancel: aborts the targeted controller");
    assertEqual(round.liveCount("s1"), 2, "cancel: other rounds stay live");

    round.cancelAll("s1");
    assertEqual(round.liveCount("s1"), 0, "unmount: no live controller remains for the session");
    assertEqual(signals.get(generationKey("s1", 9))?.aborted, true, "unmount: the generation controller is aborted");
    assertEqual(regenController.signal.aborted, true, "unmount: the regenerate controller is aborted");
    assertEqual(otherController.signal.aborted, true, "unmount: the cancelled controller stays aborted");
    assertEqual(round.liveCount("s2"), 0, "unmount: a different session was never touched");
    await started;
  } finally {
    console.warn = originalWarn;
  }
});

test("a generation cancel leaves a caller-tracked regenerate running", () => {
  const { round } = makeRound();
  const generation = new AbortController();
  const regen = new AbortController();
  round.track(generationKey("s1", 9), generation);
  round.track("regen|" + generationKey("s1", 9), regen);
  round.cancel(generationKey("s1", 9));
  assertEqual(generation.signal.aborted, true, "the generation round is cancelled");
  assertEqual(regen.signal.aborted, false, "a caller-owned regenerate survives a generation cancel");
  round.cancelAll("s1");
  assertEqual(regen.signal.aborted, true, "unmount still owns every controller");
});
