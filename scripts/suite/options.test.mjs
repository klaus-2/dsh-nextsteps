import { readFileSync } from "node:fs";
import path from "node:path";
import { suite, test, assert, assertEqual, assertThrows } from "../harness.mjs";
import { root } from "../client-harness.mjs";
import { createConversationOptions } from "../../lib/host/conversation-options.mjs";

suite("options: the canonical conversation options schema");

const LANGUAGES = ["auto", "en", "pt-BR", "zh-CN", "es", "fr", "de", "it", "ja", "ko", "ru", "ar", "hi", "id", "tr", "vi"];
const STYLE_IDS = ["next-action", "explore", "deep-dive"];
const CARD_ACTION_IDS = ["copy", "favorite", "edit", "insert", "discard", "regenerate", "moveEarlier", "moveLater", "expand", "newChat", "notRelevant"];
const GENERATION_MODES = ["auto", "on-demand"];
const CONSTANTS = {
  generateTimeoutMs: 60000,
  defaultMaxSuggestionChars: 200,
  maxCustomInstructionChars: 500,
  minLatencyBudgetMs: 5000,
  maxLatencyBudgetMs: 120000,
  minMaxSuggestionChars: 60,
  maxMaxSuggestionChars: 600
};

const FIELD_NAMES = [
  "lang",
  "maxFollowups",
  "showHeader",
  "model",
  "fallbackModel",
  "styles",
  "generationMode",
  "latencyBudgetMs",
  "maxSuggestionChars",
  "retentionDays",
  "transcriptScope",
  "customInstruction",
  "confirmBeforeSend",
  "cardActions"
];

function makeOptions(defaultOverrides) {
  return createConversationOptions({
    languages: LANGUAGES,
    styleIds: STYLE_IDS,
    cardActionIds: CARD_ACTION_IDS,
    generationModes: GENERATION_MODES,
    constants: CONSTANTS,
    defaults: defaultOverrides
  });
}

function expectedDefaults() {
  return {
    lang: "auto",
    maxFollowups: 3,
    showHeader: true,
    model: "",
    fallbackModel: false,
    styles: [...STYLE_IDS],
    generationMode: "auto",
    latencyBudgetMs: 60000,
    maxSuggestionChars: 200,
    retentionDays: 0,
    transcriptScope: "full",
    customInstruction: "",
    confirmBeforeSend: false,
    cardActions: [...CARD_ACTION_IDS]
  };
}

function deriveParity(fields, observed) {
  assert(Array.isArray(fields) && fields.length > 0, "the field table is a non-empty list");
  const parity = {};
  for (const field of fields) {
    assert(typeof field?.name === "string" && field.name !== "", "each field declares a name");
    assert(typeof field.validate === "function", `the ${field.name} field declares a normalize rule`);
    const shape = field.parity;
    assert(shape !== null && typeof shape === "object", `the ${field.name} field declares a parity shape`);
    assert(field.name in observed, `the defaults carry the ${field.name} field`);
    assert(shape.default !== undefined, `the ${field.name} parity declares its default`);
    if (shape.kind === "enum") {
      assert(Array.isArray(shape.values) && shape.values.length > 0, `the ${field.name} enum lists its values`);
      assert(shape.values.includes(shape.default), `the ${field.name} default is one of its values`);
    } else if (shape.kind === "int") {
      assert(Number.isInteger(shape.min) && Number.isInteger(shape.max) && shape.min <= shape.max, `the ${field.name} int declares a range`);
      assert(shape.default >= shape.min && shape.default <= shape.max, `the ${field.name} default sits inside its range`);
    } else if (shape.kind === "bool") {
      assert(typeof shape.default === "boolean", `the ${field.name} default is a boolean`);
    } else if (shape.kind === "string") {
      assert(typeof shape.default === "string", `the ${field.name} default is a string`);
    } else if (shape.kind === "enumList") {
      assert(Array.isArray(shape.values) && shape.values.length > 0, `the ${field.name} list declares its values`);
      assert(Array.isArray(shape.default) && shape.default.every((id) => shape.values.includes(id)), `the ${field.name} default list is drawn from its values`);
    } else {
      assert(false, `the ${field.name} parity declares a known kind`);
    }
    const matches = shape.default === observed[field.name]
      || JSON.stringify(shape.default) === JSON.stringify(observed[field.name]);
    assert(matches, `the ${field.name} parity default matches the observed default`);
    parity[field.name] = shape;
  }
  return parity;
}

test("defaults() carries the 14 source defaults in the source order", () => {
  const options = makeOptions();
  const settings = options.defaults();
  assertEqual(Object.keys(settings), FIELD_NAMES, "the 14 keys follow the source order");
  assertEqual(settings, expectedDefaults(), "the defaults match the settingsLoad fallbacks");
});

test("defaults() hands out fresh arrays on every call", () => {
  const options = makeOptions();
  const first = options.defaults();
  first.styles.push("poisoned");
  first.cardActions.push("poisoned");
  const second = options.defaults();
  assert(first.styles !== second.styles, "the styles arrays are not shared");
  assert(first.cardActions !== second.cardActions, "the cardActions arrays are not shared");
  assertEqual(second.styles, STYLE_IDS, "mutating one call's styles does not leak");
  assertEqual(second.cardActions, CARD_ACTION_IDS, "mutating one call's cardActions does not leak");
});

test("normalize keeps every valid value", () => {
  const options = makeOptions();
  const raw = {
    lang: "pt-BR",
    maxFollowups: 4,
    showHeader: false,
    model: "demo/demo-model",
    fallbackModel: true,
    styles: ["explore"],
    generationMode: "on-demand",
    latencyBudgetMs: 10000,
    maxSuggestionChars: 150,
    retentionDays: 30,
    transcriptScope: "minimal",
    customInstruction: "  answer tersely  ",
    confirmBeforeSend: true,
    cardActions: ["copy", "edit"]
  };
  assertEqual(options.normalize(raw), {
    lang: "pt-BR",
    maxFollowups: 4,
    showHeader: false,
    model: "demo/demo-model",
    fallbackModel: true,
    styles: ["explore"],
    generationMode: "on-demand",
    latencyBudgetMs: 10000,
    maxSuggestionChars: 150,
    retentionDays: 30,
    transcriptScope: "minimal",
    customInstruction: "answer tersely",
    confirmBeforeSend: true,
    cardActions: ["copy", "edit"]
  }, "every valid value survives normalization");
});

test("normalize rejects invalid values with the source fallbacks", () => {
  const options = makeOptions();
  const raw = {
    lang: "klingon",
    maxFollowups: 0,
    showHeader: "no",
    model: "no-slash",
    fallbackModel: 1,
    styles: ["bogus", 5],
    generationMode: "turbo",
    latencyBudgetMs: 4999,
    maxSuggestionChars: 601,
    retentionDays: 366,
    transcriptScope: "brief",
    customInstruction: 123,
    confirmBeforeSend: "yes",
    cardActions: "copy"
  };
  assertEqual(options.normalize(raw), expectedDefaults(), "every invalid value falls back to the source default");
});

test("normalize pins the field boundaries without clamping", () => {
  const options = makeOptions();
  const cases = [
    ["maxFollowups", 1, 1],
    ["maxFollowups", 6, 6],
    ["maxFollowups", 7, 3],
    ["maxFollowups", 3.5, 3],
    ["maxFollowups", "3", 3],
    ["latencyBudgetMs", 5000, 5000],
    ["latencyBudgetMs", 120000, 120000],
    ["latencyBudgetMs", 4999, 60000],
    ["latencyBudgetMs", 120001, 60000],
    ["maxSuggestionChars", 60, 60],
    ["maxSuggestionChars", 600, 600],
    ["maxSuggestionChars", 599, 599],
    ["maxSuggestionChars", 59, 200],
    ["retentionDays", 0, 0],
    ["retentionDays", 365, 365],
    ["retentionDays", -1, 0]
  ];
  for (const [field, value, expected] of cases) {
    assertEqual(options.normalize({ [field]: value })[field], expected, `${field}: ${JSON.stringify(value)}`);
  }
});

test("normalize treats an empty styles list as the default and an empty cardActions list as a legal empty list", () => {
  const options = makeOptions();
  assertEqual(options.normalize({ styles: [] }).styles, STYLE_IDS, "an empty styles list returns to the default styles");
  assertEqual(options.normalize({ cardActions: [] }).cardActions, [], "an empty cardActions list is preserved");
  assertEqual(options.normalize({ styles: ["explore", "bogus", "explore", 5] }).styles, ["explore"], "invalid and duplicate style ids are filtered");
  assertEqual(options.normalize({ cardActions: ["copy", "bogus", "copy", 7] }).cardActions, ["copy"], "invalid and duplicate action ids are filtered");
});

test("normalize resolves the model through the source rules, and a legacy provider/model pair reads empty because modelKeyOf's composition branch is unreachable", () => {
  const options = makeOptions();
  assertEqual(options.normalize({ model: "demo/demo-model" }).model, "demo/demo-model", "a composed key survives");
  assertEqual(options.normalize({ model: "" }).model, "", "an empty string resets");
  assertEqual(options.normalize({}).model, "", "an absent model resets");
  assertEqual(options.normalize({ model: null }).model, "", "a null model resets");
  assertEqual(options.normalize({ model: "no-slash" }).model, "", "a plain string without a slash resets");
  assertEqual(options.normalize({ provider: "p", model: "m" }).model, "", "a legacy provider/model pair reads empty like today");
  assertEqual(options.normalize({ provider: "p" }).model, "", "a legacy provider-only pair reads empty");
});

test("normalize survives raw values that are not objects", () => {
  const options = makeOptions();
  assertEqual(options.normalize(null), expectedDefaults(), "null reads as an empty store");
  assertEqual(options.normalize(42), expectedDefaults(), "a number reads as an empty store");
  assertEqual(options.normalize("x"), expectedDefaults(), "a string reads as an empty store");
  assertEqual(options.normalize({ nope: 1, alsoNope: "x" }), expectedDefaults(), "unknown keys are ignored");
});

test("normalize({}) matches defaults()", () => {
  const options = makeOptions();
  assertEqual(options.normalize({}), options.defaults(), "an empty store normalizes to the defaults");
});

test("merge swaps the fields a valid patch carries", () => {
  const options = makeOptions();
  const current = options.defaults();
  const next = options.merge(current, {
    lang: "en",
    maxFollowups: 5,
    showHeader: false,
    model: "demo/demo-model",
    fallbackModel: true,
    styles: ["deep-dive"],
    generationMode: "on-demand",
    latencyBudgetMs: 20000,
    maxSuggestionChars: 300,
    retentionDays: 90,
    transcriptScope: "minimal",
    customInstruction: "  be direct  ",
    confirmBeforeSend: true,
    cardActions: ["copy", "expand"]
  });
  assertEqual(next, {
    lang: "en",
    maxFollowups: 5,
    showHeader: false,
    model: "demo/demo-model",
    fallbackModel: true,
    styles: ["deep-dive"],
    generationMode: "on-demand",
    latencyBudgetMs: 20000,
    maxSuggestionChars: 300,
    retentionDays: 90,
    transcriptScope: "minimal",
    customInstruction: "be direct",
    confirmBeforeSend: true,
    cardActions: ["copy", "expand"]
  }, "every valid patch value replaces the current one");
  assert(next.styles !== current.styles, "a swapped styles list is a fresh array");
});

test("merge keeps the current value when the patch value is invalid", () => {
  const options = makeOptions();
  const current = options.defaults();
  const next = options.merge(current, {
    lang: "klingon",
    maxFollowups: 0,
    showHeader: "no",
    fallbackModel: 1,
    styles: "nope",
    generationMode: "turbo",
    latencyBudgetMs: 4999,
    maxSuggestionChars: 601,
    retentionDays: 366,
    transcriptScope: "brief",
    customInstruction: 123,
    confirmBeforeSend: "yes",
    cardActions: "nope"
  });
  assertEqual(next, current, "an invalid patch value keeps the current field");
});

test("merge resets the model on an empty patch value and keeps it on an invalid non-empty one", () => {
  const options = makeOptions();
  const current = { ...options.defaults(), model: "demo/demo-model" };
  assertEqual(options.merge(current, { model: "" }).model, "", "an empty string resets the model");
  assertEqual(options.merge(current, { model: undefined }).model, "", "an undefined model resets");
  assertEqual(options.merge(current, { model: null }).model, "", "a null model resets");
  assertEqual(options.merge(current, { model: "other/one" }).model, "other/one", "a composed key swaps");
  assertEqual(options.merge(current, { model: "no-slash" }).model, "demo/demo-model", "a plain string without a slash keeps the current model");
});

test("merge treats an empty styles patch as keep and an empty cardActions patch as clear", () => {
  const options = makeOptions();
  const current = { ...options.defaults(), styles: ["explore"], cardActions: ["copy"] };
  assertEqual(options.merge(current, { styles: [] }).styles, ["explore"], "an empty styles patch keeps the current styles");
  assertEqual(options.merge(current, { cardActions: [] }).cardActions, [], "an empty cardActions patch is a legal clear");
});

test("merge leaves the current settings object untouched on any patch, including none", () => {
  const options = makeOptions();
  const current = options.defaults();
  const snapshot = JSON.parse(JSON.stringify(current));
  const swapped = options.merge(current, { lang: "en", styles: ["deep-dive"], cardActions: [] });
  assert(swapped !== current, "a swap returns a new object");
  assertEqual(current, snapshot, "the current object keeps its values after a swap");
  for (const patch of [undefined, 42, "patch", null]) {
    const next = options.merge(current, patch);
    assert(next !== current, `a ${typeof patch} patch returns a new object`);
    for (const name of FIELD_NAMES) {
      const expected = name === "model" ? "" : current[name];
      assertEqual(next[name], expected, `the ${name} field with a ${String(patch)} patch follows the source rule`);
    }
    assertEqual(current, snapshot, "the current object keeps its values after a patch without keys");
  }
});

test("sanitizeOverride keeps only the fields the generate body may override", () => {
  const options = makeOptions();
  assertEqual(
    options.sanitizeOverride({ lang: "pt-BR", maxFollowups: 5, model: "p/m", customInstruction: "  focus  " }),
    { lang: "pt-BR", maxFollowups: 5, model: "p/m", customInstruction: "focus" },
    "the four overridable fields carry their sanitized values"
  );
  assertEqual(options.sanitizeOverride({ lang: "auto" }), { customInstruction: "" }, "the auto language never overrides");
  assertEqual(options.sanitizeOverride({ maxFollowups: 99 }), { customInstruction: "" }, "an out-of-range count never overrides");
  assertEqual(options.sanitizeOverride({ model: "no-slash" }), { customInstruction: "" }, "a model without a slash never overrides");
  assertEqual(options.sanitizeOverride({}), { customInstruction: "" }, "an empty body still carries an empty instruction");
  assertEqual(options.sanitizeOverride(undefined), { customInstruction: "" }, "a missing body still carries an empty instruction");
  assertEqual(options.sanitizeOverride({ customInstruction: "   " }).customInstruction, "", "a spaces-only instruction trims to empty");
  const long = "x".repeat(600);
  const cut = options.sanitizeOverride({ customInstruction: long }).customInstruction;
  assertEqual(cut.length, 500, "a long instruction is cut to the source cap");
  assertEqual(cut, "x".repeat(500), "the cut keeps the first 500 characters");
});

test("the injected defaults override the timeout fallback for the latency budget", () => {
  const options = makeOptions({ latencyBudgetMs: 45000 });
  assertEqual(options.defaults().latencyBudgetMs, 45000, "the caller default wins");
  assertEqual(options.normalize({}).latencyBudgetMs, 45000, "the caller default backs the normalize fallback");
  assertEqual(options.normalize({ latencyBudgetMs: 5000 }).latencyBudgetMs, 5000, "a value inside the range is still kept");
  assertEqual(options.normalize({ latencyBudgetMs: 4999 }).latencyBudgetMs, 45000, "a value outside the range falls back to the caller default");
});

test("the parity table stays self-consistent with the observed defaults", () => {
  const options = makeOptions();
  assertEqual(options.fields.map((field) => field.name), FIELD_NAMES, "the field table carries the 14 canonical names in order");
  for (const field of options.fields) {
    assert(typeof field.validate === "function", `the ${field.name} field declares a normalize rule`);
  }
  const parity = deriveParity(options.fields, options.defaults());
  assertEqual(Object.keys(parity), FIELD_NAMES, "the derived parity table covers the same 14 fields");
});

test("the parity derivation fails on a control table instead of passing vacuously", () => {
  const observed = { maxFollowups: 3 };
  assertThrows(
    () => deriveParity([{ name: "lang", validate: () => "auto", parity: { kind: "enum", values: [], default: "auto" } }], observed),
    "an enum with no values fails the derivation",
  );
  assertThrows(
    () => deriveParity([{ name: "maxFollowups", validate: () => 3, parity: { kind: "int", min: 1, max: 6, default: 4 } }], observed),
    "a declared default that drifts from the observed default fails the derivation",
  );
  assertThrows(
    () => deriveParity([{ name: "showHeader", validate: () => true }], observed),
    "a field without a parity shape fails the derivation",
  );
  assertThrows(
    () => deriveParity([], observed),
    "an empty field table fails the derivation",
  );
});

const PARITY_BLOCK_PATTERN = /\/\* CONVERSATION-OPTIONS-PARITY:BEGIN \*\/([\s\S]*?)\/\* CONVERSATION-OPTIONS-PARITY:END \*\//;
const clientSource = readFileSync(path.join(root, "client.js"), "utf8");

function parseParityBlock(source) {
  const match = source.match(PARITY_BLOCK_PATTERN);
  return match === null ? null : JSON.parse(match[1]);
}

function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item)}`).sort();
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

test("the inline client mirror matches the canonical parity table field for field", () => {
  const options = makeOptions();
  const observed = options.defaults();
  const mirror = parseParityBlock(clientSource);
  assert(mirror !== null, "the client carries the CONVERSATION-OPTIONS-PARITY block");
  assertEqual(Object.keys(mirror), options.fields.map((field) => field.name), "the mirror lists the canonical 14 names in module order");
  for (const field of options.fields) {
    assertEqual(sortedJson(mirror[field.name]), sortedJson(field.parity), `the ${field.name} mirror entry equals the canonical parity shape`);
    assertEqual(mirror[field.name].default, observed[field.name], `the ${field.name} mirror default matches the observed default`);
  }
});

test("the mirror extraction is real: a source without the markers yields nothing and the client carries the block", () => {
  assertEqual(parseParityBlock("const DEFAULT_SETTINGS = { lang: 'auto' };"), null, "a control source without the markers parses to nothing");
  assert(parseParityBlock(clientSource) !== null, "the real client source yields the parity block");
});
