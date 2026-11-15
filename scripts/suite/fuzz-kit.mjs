export const FUZZ_SEED = 20251114;
export const FUZZ_COUNT = 512;

export function mulberry32(seed) {
  let a = seed | 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROMPT = "Fix the failing test";

function deepValue(levels) {
  let value = "bottom";
  for (let level = 0; level < levels; level += 1) value = { nested: value };
  return value;
}

let fixedCache;

function fixedPayloads() {
  if (fixedCache !== undefined) return fixedCache;
  fixedCache = [
    null,
    true,
    false,
    0,
    -1,
    1.5,
    "",
    "x",
    "x".repeat(1e6),
    "\u0000",
    "high surrogate alone: \ud83d",
    [],
    [null],
    [1],
    [[]],
    [deepValue(50)],
    Array.from({ length: 10000 }, (entry, index) => (index % 2 === 0 ? null : { prompt: PROMPT + " " + index })),
    {},
    { followups: null },
    { followups: "x" },
    { __proto__: { x: 1 }, followups: [{ prompt: "proto", label: "P" }] },
    { followups: [{ prompt: "p" }], extra: "ignored" },
    { followups: [{ prompt: "" }] },
    { followups: [{ prompt: "   " }] },
    { followups: [{ prompt: null }] },
    { followups: [{ prompt: 123 }] },
    { followups: [{ prompt: "p", label: 42 }] },
    { followups: [{ prompt: { deep: { deeper: 1 } } }] },
    '{"followups":[{"prompt":',
    "```json\n{\"followups\":[{\"prompt\":\"fenced\",\"label\":\"F\"}]}\n```",
    'The model said: {"followups":[{"prompt":"salvaged","label":"S"}]} and then rambled on about braces } and quotes ".',
    '{"prompt":"x"}'.repeat(1000),
    JSON.stringify(deepValue(1000)),
    JSON.stringify(JSON.stringify({ followups: [{ prompt: "double", label: "D" }] })),
    Array.from({ length: 6 }, (entry, index) => ({ prompt: PROMPT + " " + index, label: "L" + index })),
    Array.from({ length: 7 }, (entry, index) => ({ prompt: PROMPT + " " + index, label: "L" + index })),
    { followups: [{ prompt: "q".repeat(200), label: "edge" }] },
    { followups: [{ prompt: "q".repeat(201), label: "over" }] }
  ];
  return fixedCache;
}

function mutatedPayload(index) {
  const random = mulberry32((FUZZ_SEED + index) | 0);
  const pick = (entries) => entries[Math.min(entries.length - 1, Math.floor(random() * entries.length))];
  const junk = ["", "   ", "p", PROMPT, "\u0000", "\ud83d\ude00", "y".repeat(1 + Math.floor(random() * 600))];
  const prompts = ["", "   ", null, 123, {}, [], true, deepValue(1 + Math.floor(random() * 12)), ...junk, PROMPT + " " + index];
  const labels = [undefined, null, "", "l", 42, {}, "long label ".repeat(8)];
  const items = [];
  const count = 1 + Math.floor(random() * 9);
  for (let entry = 0; entry < count; entry += 1) {
    const item = { prompt: pick(prompts) };
    const label = pick(labels);
    if (label !== undefined) item.label = label;
    if (random() < 0.15) item[pick(["extra", "nested", "prompt "])] = pick(["junk", 1, null]);
    items.push(item);
  }
  const wrap = Math.floor(random() * 5);
  if (wrap === 0) return items;
  if (wrap === 1) return { followups: items };
  if (wrap === 2) return { followups: items, note: pick(junk) };
  if (wrap === 3) return JSON.stringify(JSON.stringify({ followups: items }));
  return JSON.stringify({ followups: items });
}

export function buildPayload(index) {
  if (!Number.isInteger(index) || index < 0 || index >= FUZZ_COUNT) {
    throw new Error(`buildPayload expects an index in [0, ${FUZZ_COUNT}), received ${index}`);
  }
  const fixed = fixedPayloads();
  if (index < fixed.length) return fixed[index];
  return mutatedPayload(index);
}

export const IN_MEMORY_PAYLOADS = [
  { note: "an envelope without a prototype", inMemory: true, payload: Object.assign(Object.create(null), { followups: [{ prompt: "protoless", label: "P" }] }) },
  { note: "an envelope whose followups getter throws", inMemory: true, payload: { get followups() { throw new Error("boom-followups"); } } },
  { note: "an item whose prompt getter throws", inMemory: true, payload: [{ get prompt() { throw new Error("boom-prompt"); } }] },
  { note: "a proxy whose get throws", inMemory: true, payload: new Proxy({}, { get() { throw new Error("boom-proxy"); } }) }
];

export function fuzzMessage(index, payload, note) {
  let serialized;
  try {
    serialized = JSON.stringify(payload) ?? String(payload);
  } catch {
    serialized = String(payload);
  }
  return `${note} [seed ${FUZZ_SEED} index ${index}] ${serialized.slice(0, 300)}`;
}

export function assertFollowupsShape(list, { promptCap, labelCap = 40, max = 6 }, message) {
  const fail = (why) => {
    throw new Error(`${message ?? "the followups broke their shape"}: ${why}`);
  };
  if (list === undefined || list === null) return;
  if (!Array.isArray(list)) fail(`the list is ${typeof list}, not an array`);
  if (list.length > max) fail(`the list carries ${list.length} cards, over the cap of ${max}`);
  for (const item of list) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) fail(`a card is ${JSON.stringify(item)?.slice(0, 60)}, not an object`);
    for (const key of Object.keys(item)) {
      if (key !== "prompt" && key !== "label") fail(`a card carries the unexpected key ${key}`);
    }
    if (typeof item.prompt !== "string") fail(`the prompt is ${typeof item.prompt}, not a string`);
    if (item.prompt.trim() === "") fail("the prompt is empty or whitespace");
    if (item.prompt.length > promptCap) fail(`the prompt carries ${item.prompt.length} chars, over the cap of ${promptCap}`);
    if (item.label !== null && typeof item.label !== "string") fail(`the label is ${typeof item.label}, not null or a string`);
    if (typeof item.label === "string" && labelCap !== null && item.label.length > labelCap) {
      fail(`the label carries ${item.label.length} chars, over the cap of ${labelCap}`);
    }
  }
}
