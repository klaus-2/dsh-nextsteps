import { suite, test, assert, assertEqual } from "../harness.mjs";
import { createFollowupInterpretation } from "../../lib/host/followup-interpretation.mjs";

suite("interpretation: the followup parsers behind one interpret gate");

const interpretation = createFollowupInterpretation({
  styleIds: ["next-action", "explore", "deep-dive"],
  defaultMaxChars: 200,
  maxFollowupsOf: () => 4
});

test("coerceFollowups parses a JSON string into the followups array", () => {
  assertEqual(interpretation.coerceFollowups('[{"prompt":"Run tests"}]'), [{ prompt: "Run tests" }]);
});

test("coerceFollowups answers undefined for a JSON string it cannot parse", () => {
  assertEqual(interpretation.coerceFollowups("not json"), undefined);
});

test("coerceFollowups unwraps an object that carries the followups array", () => {
  assertEqual(interpretation.coerceFollowups('{"followups":[{"prompt":"Run tests"}]}'), [{ prompt: "Run tests" }]);
  assertEqual(interpretation.coerceFollowups({ followups: [{ prompt: "Run tests" }] }), [{ prompt: "Run tests" }]);
});

test("coerceFollowups turns a scalar object into a single-item array", () => {
  assertEqual(interpretation.coerceFollowups({ prompt: "x" }), [{ prompt: "x" }]);
});

test("coerceFollowups answers undefined for undefined and null", () => {
  assertEqual(interpretation.coerceFollowups(undefined), undefined);
  assertEqual(interpretation.coerceFollowups(null), undefined);
});

test("coerceFollowups wraps a non-object scalar and validation rejects the wrapped entry", () => {
  const coerced = interpretation.coerceFollowups(42);
  assertEqual(coerced, [42]);
  assertEqual(
    interpretation.validationProblem(coerced),
    "Error: each followup must be an object with a non-empty `prompt` string. Retry with valid followups."
  );
});

test("validationProblem pins the non-empty array message with the typeof shape for a bare scalar", () => {
  assertEqual(
    interpretation.validationProblem(42),
    "Error: `followups` must be a non-empty array (aim for 4) of objects with a non-empty `prompt` string and an optional short `label` string. Received number. Retry with valid followups."
  );
});

test("coerceFollowups answers undefined when the followups property getter throws", () => {
  const exploding = new Proxy({}, { get() { throw new Error("boom"); } });
  assertEqual(interpretation.coerceFollowups(exploding), undefined);
});

test("validationProblem pins the non-empty array message with the nothing usable shape", () => {
  assertEqual(
    interpretation.validationProblem(null),
    "Error: `followups` must be a non-empty array (aim for 4) of objects with a non-empty `prompt` string and an optional short `label` string. Received nothing usable. Retry with valid followups."
  );
});

test("validationProblem pins the non-empty array message with the array(0) shape", () => {
  assertEqual(
    interpretation.validationProblem([]),
    "Error: `followups` must be a non-empty array (aim for 4) of objects with a non-empty `prompt` string and an optional short `label` string. Received array(0). Retry with valid followups."
  );
});

test("validationProblem pins the object message for a non-object entry", () => {
  assertEqual(
    interpretation.validationProblem([7]),
    "Error: each followup must be an object with a non-empty `prompt` string. Retry with valid followups."
  );
});

test("validationProblem pins the object message when a prompt getter throws", () => {
  const exploding = new Proxy({}, { get() { throw new Error("boom"); } });
  assertEqual(
    interpretation.validationProblem([exploding]),
    "Error: each followup must be an object with a non-empty `prompt` string. Retry with valid followups."
  );
});

test("validationProblem pins the prompt message for a blank or missing prompt", () => {
  assertEqual(
    interpretation.validationProblem([{ prompt: "   " }]),
    "Error: each followup needs a non-empty `prompt` string (the message sent when the user clicks). Retry with valid followups."
  );
  assertEqual(
    interpretation.validationProblem([{ label: "x" }]),
    "Error: each followup needs a non-empty `prompt` string (the message sent when the user clicks). Retry with valid followups."
  );
});

test("validationProblem pins the label message for a blank or non-string label", () => {
  assertEqual(
    interpretation.validationProblem([{ prompt: "Run tests", label: "   " }]),
    "Error: `label` must be a short non-empty string when present. Retry with valid followups."
  );
  assertEqual(
    interpretation.validationProblem([{ prompt: "Run tests", label: 7 }]),
    "Error: `label` must be a short non-empty string when present. Retry with valid followups."
  );
});

test("validationProblem answers null for a valid list", () => {
  assertEqual(interpretation.validationProblem([{ prompt: "Run tests", label: "Tests" }]), null);
});

test("followupsFromModelText answers undefined for a non-string or empty text", () => {
  assertEqual(interpretation.followupsFromModelText(undefined), undefined);
  assertEqual(interpretation.followupsFromModelText(42), undefined);
  assertEqual(interpretation.followupsFromModelText(""), undefined);
});

test("followupsFromModelText strips a json code fence", () => {
  assertEqual(
    interpretation.followupsFromModelText('```json\n{"followups":[{"prompt":"Run tests","label":"Tests"}]}\n```'),
    [{ prompt: "Run tests", label: "Tests" }]
  );
});

test("followupsFromModelText parses pure JSON and normalizes a missing label to null", () => {
  assertEqual(
    interpretation.followupsFromModelText('{"followups":[{"prompt":"Run tests"}]}'),
    [{ prompt: "Run tests", label: null }]
  );
});

test("followupsFromModelText slices from the first brace to the last one", () => {
  assertEqual(
    interpretation.followupsFromModelText('Claro! {"followups":[{"prompt":"Run tests","label":"Tests"}]} espero ajudar.'),
    [{ prompt: "Run tests", label: "Tests" }]
  );
});

test("followupsFromModelText salvages valid objects out of broken JSON, honoring braces and escaped quotes inside strings", () => {
  const text = 'garbage {"x":1} {"prompt":"usar { e } com cuidado","label":"A"} more {"prompt":"run \\"tests\\" now"} tail';
  assertEqual(
    interpretation.followupsFromModelText(text),
    [
      { prompt: "usar { e } com cuidado", label: "A" },
      { prompt: 'run "tests" now', label: null }
    ]
  );
});

test("followupsFromModelText drops a balanced brace candidate that is not JSON while salvaging a valid one", () => {
  const text = 'broken {not json} then {"prompt":"run tests"}';
  assertEqual(
    interpretation.followupsFromModelText(text),
    [{ prompt: "run tests", label: null }]
  );
});

test("followupsFromModelText filters entries without a usable prompt", () => {
  assertEqual(
    interpretation.followupsFromModelText('{"followups":[null,{"label":"no prompt"},{"prompt":"   "},{"prompt":"Run tests"}]}'),
    [{ prompt: "Run tests", label: null }]
  );
});

test("followupsFromModelText caps the result at six cards", () => {
  const text = JSON.stringify({ followups: Array.from({ length: 7 }, (entry, index) => ({ prompt: `card ${index}` })) });
  const parsed = interpretation.followupsFromModelText(text);
  assertEqual(parsed.length, 6, "the seventh card never survives");
  assertEqual(parsed.map((entry) => entry.prompt), ["card 0", "card 1", "card 2", "card 3", "card 4", "card 5"]);
});

test("followupsFromModelText slices the prompt to the cap and falls back to the default for an invalid cap", () => {
  const text = JSON.stringify({ followups: [{ prompt: "z".repeat(250) }] });
  assertEqual(interpretation.followupsFromModelText(text)[0].prompt.length, 200, "the default cap slices 250 chars to 200");
  assertEqual(interpretation.followupsFromModelText(text, 10)[0].prompt.length, 10, "an integer cap slices to itself");
  assertEqual(interpretation.followupsFromModelText(text, 0)[0].prompt.length, 200, "zero falls back to the default");
  assertEqual(interpretation.followupsFromModelText(text, "x")[0].prompt.length, 200, "a non-integer falls back to the default");
});

test("followupsFromModelText normalizes the label to null or a 40-char slice", () => {
  const text = JSON.stringify({
    followups: [
      { prompt: "a", label: "   " },
      { prompt: "b", label: 42 },
      { prompt: "c", label: "  spaced  " },
      { prompt: "d", label: "L".repeat(50) }
    ]
  });
  const parsed = interpretation.followupsFromModelText(text);
  assertEqual(parsed[0].label, null, "a blank label normalizes to null");
  assertEqual(parsed[1].label, null, "a non-string label normalizes to null");
  assertEqual(parsed[2].label, "  spaced  ", "a non-blank label is kept untrimmed");
  assertEqual(parsed[3].label, "L".repeat(40), "a long label is sliced to 40 chars");
});

test("followupsFromModelText keeps a known style id and drops an unknown one", () => {
  const parsed = interpretation.followupsFromModelText(JSON.stringify({
    followups: [
      { prompt: "a", style: "explore" },
      { prompt: "b", style: "bogus" }
    ]
  }));
  assertEqual(parsed[0], { prompt: "a", label: null, style: "explore" }, "a known style id rides the card");
  assertEqual(parsed[1], { prompt: "b", label: null }, "an unknown style id leaves no style key");
});

test("interpret accepts all three declared sources and answers ok with followups", () => {
  assertEqual(interpretation.interpret({ source: "tool-args", value: [{ prompt: "x" }] }), { ok: true, followups: [{ prompt: "x" }] });
  assertEqual(
    interpretation.interpret({ source: "model-text", value: '{"followups":[{"prompt":"a"},{"prompt":"b"}]}' }),
    { ok: true, followups: [{ prompt: "a", label: null }, { prompt: "b", label: null }] }
  );
  assertEqual(
    interpretation.interpret({ source: "fixture", value: '{"followups":[{"prompt":"a"},{"prompt":"b"}]}' }),
    { ok: true, followups: [{ prompt: "a", label: null }, { prompt: "b", label: null }] }
  );
});

test("interpret answers ok:false with the byte-exact validation problem on the tool path", () => {
  assertEqual(
    interpretation.interpret({ source: "tool-args", value: null }),
    { ok: false, problem: "Error: `followups` must be a non-empty array (aim for 4) of objects with a non-empty `prompt` string and an optional short `label` string. Received nothing usable. Retry with valid followups." }
  );
});

test("interpret ignores maxFollowups on the tool path: it never slices and always validates against maxFollowupsOf", () => {
  const five = Array.from({ length: 5 }, (entry, index) => ({ prompt: `p ${index}` }));
  const outcome = interpretation.interpret({ source: "tool-args", value: five, maxFollowups: 2 });
  assertEqual(outcome.ok, true, "five valid followups validate");
  assertEqual(outcome.followups.length, 5, "the tool path keeps every validated followup");
  assertEqual(
    interpretation.interpret({ source: "tool-args", value: undefined, maxFollowups: 99 }),
    { ok: false, problem: "Error: `followups` must be a non-empty array (aim for 4) of objects with a non-empty `prompt` string and an optional short `label` string. Received nothing usable. Retry with valid followups." }
  );
});

test("interpret parses the fixture source through the same parser as model-text", () => {
  const value = '```json\n{"followups":[{"prompt":"Fixo","label":"Fixo"}]}\n```';
  const expected = [{ prompt: "Fixo", label: "Fixo" }];
  assertEqual(interpretation.interpret({ source: "fixture", value }), { ok: true, followups: expected });
  assertEqual(interpretation.interpret({ source: "model-text", value }), { ok: true, followups: expected });
});

test("interpret slices the text sources to an explicit maxFollowups and falls back to maxFollowupsOf", () => {
  const three = '{"followups":[{"prompt":"a"},{"prompt":"b"},{"prompt":"c"}]}';
  assertEqual(
    interpretation.interpret({ source: "model-text", value: three, maxFollowups: 2 }).followups.map((entry) => entry.prompt),
    ["a", "b"],
    "an explicit integer count slices the parsed cards"
  );
  assertEqual(
    interpretation.interpret({ source: "fixture", value: three, maxFollowups: 0 }).followups.length,
    3,
    "a count below 1 falls back to maxFollowupsOf"
  );
  assertEqual(
    interpretation.interpret({ source: "model-text", value: three, maxFollowups: 1.5 }).followups.length,
    3,
    "a non-integer count falls back to maxFollowupsOf"
  );
});

test("interpret falls back to the default cap when maxChars is invalid", () => {
  const sliced = interpretation.interpret({
    source: "model-text",
    value: JSON.stringify({ followups: [{ prompt: "z".repeat(250) }] }),
    maxChars: 0
  });
  assertEqual(sliced.followups[0].prompt.length, 200, "an invalid maxChars uses defaultMaxChars");
  const junk = interpretation.interpret({
    source: "fixture",
    value: JSON.stringify({ followups: [{ prompt: "z".repeat(250) }] }),
    maxChars: "x"
  });
  assertEqual(junk.followups[0].prompt.length, 200, "a non-integer maxChars uses defaultMaxChars");
});

test("interpret answers the byte-exact no-usable problem for text sources it cannot parse", () => {
  assertEqual(
    interpretation.interpret({ source: "model-text", value: "no json here at all" }),
    { ok: false, problem: "Error: the reply contains no usable followups JSON. Retry with valid followups." }
  );
  assertEqual(
    interpretation.interpret({ source: "fixture", value: "" }),
    { ok: false, problem: "Error: the reply contains no usable followups JSON. Retry with valid followups." }
  );
});

test("interpret throws a TypeError for an unknown source", () => {
  let caught;
  try {
    interpretation.interpret({ source: "transcript", value: "x" });
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof TypeError, "an unknown source is a programmer error, not a runtime input");
  let missing;
  try {
    interpretation.interpret({ value: "x" });
  } catch (error) {
    missing = error;
  }
  assert(missing instanceof TypeError, "a missing source is a programmer error too");
});
