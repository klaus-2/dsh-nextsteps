// SPDX-License-Identifier: MIT
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const TOOL_NAME = 'suggest_followups';
const name = 'dsh-nextsteps';
const inject = ['tools', 'connection', 'sessionQuery'];
const NPM_NAME = 'dsh-nextsteps';
const RELEASES_URL = 'https://api.github.com/repos/klaus-2/dsh-nextsteps/releases/latest';
const SETTINGS_FILE = path.join(homedir(), '.dsh', 'dsh-nextsteps', 'settings.json');
const PACKAGE = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const GENERATE_TIMEOUT_MS = 30000;
const GENERATE_MAX_TOKENS = 500;

const LANGUAGE_NAMES = {
  auto: "the same language as the conversation",
  'en': "English",
  'pt-BR': "Brazilian Portuguese",
  'zh-CN': "Simplified Chinese",
  'es': "Spanish",
  'fr': "French",
  'de': "German",
  'it': "Italian",
  'ja': "Japanese",
  'ko': "Korean",
  'ru': "Russian",
  'ar': "Arabic",
  'hi': "Hindi",
  'id': "Indonesian",
  'tr': "Turkish",
  'vi': "Vietnamese"
};

function modelKeyOf(stored) {
  if (stored === null || typeof stored !== 'object') return '';
  if (typeof stored.model === 'string') return stored.model.includes('/') ? stored.model : '';
  const provider = typeof stored.provider === 'string' ? stored.provider : '';
  const model = typeof stored.model === 'string' ? stored.model : '';
  return provider !== '' && model !== '' ? `${provider}/${model}` : '';
}

function settingsLoad() {
  try {
    const stored = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) ?? {};
    return {
      lang: ["auto","en","pt-BR","zh-CN","es","fr","de","it","ja","ko","ru","ar","hi","id","tr","vi"].includes(stored.lang) ? stored.lang : 'auto',
      maxFollowups: Number.isInteger(stored.maxFollowups) && stored.maxFollowups >= 1 && stored.maxFollowups <= 6 ? stored.maxFollowups : 3,
      showHeader: stored.showHeader !== false,
      model: typeof stored.model === 'string' ? (stored.model.includes('/') ? stored.model : '') : modelKeyOf(stored)
    };
  } catch {
    return { lang: 'auto', maxFollowups: 3, showHeader: true, model: '' };
  }
}

async function settingsSave(next) {
  await mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2));
}

function coerceFollowups(raw) {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.followups)) {
    raw = raw.followups;
  }
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) raw = [raw];
  return raw;
}

function validationProblem(followups) {
  const shape = followups === undefined || followups === null ? 'nothing usable'
    : Array.isArray(followups) ? `array(${followups.length})`
    : typeof followups;
  if (!Array.isArray(followups) || followups.length === 0) {
    return `Error: \`followups\` must be a non-empty array (aim for ${settingsLoad().maxFollowups}) of objects with a non-empty \`prompt\` string and an optional short \`label\` string. Received ${shape}. Retry with valid followups.`;
  }
  for (const followup of followups) {
    if (followup === null || typeof followup !== 'object') {
      return 'Error: each followup must be an object with a non-empty `prompt` string. Retry with valid followups.';
    }
    if (typeof followup.prompt !== 'string' || followup.prompt.trim() === '') {
      return 'Error: each followup needs a non-empty `prompt` string (the message sent when the user clicks). Retry with valid followups.';
    }
    if (followup.label !== undefined && (typeof followup.label !== 'string' || followup.label.trim() === '')) {
      return 'Error: `label` must be a short non-empty string when present. Retry with valid followups.';
    }
  }
  return null;
}

const PARAMETER_SCHEMA = {
  type: 'object',
  properties: {
    followups: {
      type: 'array',
      description: 'List of suggested followup prompts the user can click to send.',
      items: {
        type: 'object',
        additionalProperties: false,
        description: 'One suggested followup card.',
        properties: {
          prompt: {
            type: 'string',
            description: 'The message sent verbatim when the user clicks; short, goal-oriented, first-person.'
          },
          label: {
            type: 'string',
            description: 'Short display label for the card, 2-5 words; defaults to a truncated prompt.'
          }
        },
        required: ['prompt']
      }
    }
  },
  required: ['followups']
};

function toolDescription() {
  return [
    'MANDATORY in every turn: once all real work and other tool calls are done, call this tool BEFORE writing your final answer — the answer must come after this tool returns, so the turn ends cleanly right after it. Never write your final answer before calling it.',
    'Suggest exactly the number of followup prompts stated in the nextsteps section of the system prompt.',
    'Good suggestions include alternatives to the latest implementation, related features, cleanup opportunities, tests to add, or verification steps you could run yourself; if plan steps remain, one suggestion may be continuing with the next step.',
    `Each prompt must be short (usually one sentence), goal-oriented — name the outcome, not the steps — stand alone without conversation context, and be phrased in the user's first-person voice.`,
    'Write every prompt and label in the language the nextsteps section of the system prompt states.',
    'Never suggest actions the user would carry out themselves outside this session (e.g. "commit these changes"); judge by the tools you actually have.',
    'This never waits for an answer: its result only confirms the suggestions were recorded.',
    'Example input:',
    '{"followups":[{"prompt":"Show me how to run the test suite","label":"Run tests"},{"prompt":"Add error handling for empty uploads","label":"Handle empty uploads"},{"prompt":"What about handling streaming updates?","label":"Streaming updates"}]}'
  ].join('\n');
}

function nextstepsSectionText() {
  const settings = settingsLoad();
  const language = LANGUAGE_NAMES[settings.lang] ?? LANGUAGE_NAMES.auto;
  const languageRule = settings.lang === 'auto'
    ? `Write every prompt and label in the same language the conversation has been using.`
    : `LANGUAGE OVERRIDE, applies to the suggest_followups tool only: write every prompt and label in ${language} — even if the conversation or the session history is in another language. Never copy the conversation's language here.`;
  return [
    'nextsteps (the followup suggestion cards):',
    `- Suggest exactly ${settings.maxFollowups} followup prompts when you call suggest_followups.`,
    `- ${languageRule}`
  ].join('\n');
}

const PLUGIN_REV = 'sf-2';

function toolSpec() {
  return {
    name: TOOL_NAME,
    description: toolDescription(),
    parameters: PARAMETER_SCHEMA,
    output: {
      schema: { type: 'string' },
      render: (args, value) => [
        { type: 'text', text: value },
        { type: 'text', text: JSON.stringify({ rev: PLUGIN_REV, followups: coerceFollowups(args.followups) ?? [] }) }
      ]
    },
    async execute(args) {
      const followups = coerceFollowups(args.followups);
      const problem = validationProblem(followups);
      if (problem !== null) return problem;
      return 'Followups recorded. Now write your final answer for this turn (do not call this tool again).';
    }
  };
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? ''));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

const get = (ctx, serviceName) => { try { return ctx.get?.(serviceName); } catch { return undefined; } };

async function modelCatalog(ctx) {
  const llm = get(ctx, 'llm');
  const fallback = get(ctx, 'agentDefaultModel')?.currentSelection?.();
  const out = {
    default: typeof fallback?.provider === 'string' && typeof fallback?.model === 'string' && fallback.provider !== '' && fallback.model !== ''
      ? { provider: fallback.provider, model: fallback.model }
      : undefined,
    groups: []
  };
  if (llm?.listProviders === undefined) return out;
  for (const provider of llm.listProviders()) {
    try {
      const models = (await llm.listModels(provider.id)).map((entry) => ({ id: entry.id, name: entry.name }));
      if (models.length > 0) out.groups.push({ id: provider.id, name: provider.name ?? provider.id, models });
    } catch {
      continue;
    }
  }
  return out;
}

function turnTranscript(events, afterSeq) {
  const lines = [];
  for (const entry of events) {
    const event = entry?.event ?? entry;
    if (event === null || typeof event !== 'object') continue;
    if (Number.isSafeInteger(afterSeq) && Number.isSafeInteger(event.seq) && event.seq > afterSeq) break;
    if (event.type === 'user/message' && typeof event.data?.text === 'string') lines.push(`User: ${event.data.text.slice(0, 2000)}`);
    else if (event.type === 'agent/message' && typeof event.data?.text === 'string') lines.push(`Assistant: ${event.data.text.slice(0, 2000)}`);
    else if (event.type === 'tool/call' && typeof event.data?.name === 'string') lines.push(`Tool call: ${event.data.name}`);
  }
  return lines.join('\n\n');
}

function generateSystem(settings) {
  const language = LANGUAGE_NAMES[settings.lang] ?? LANGUAGE_NAMES.auto;
  const languageRule = settings.lang === 'auto'
    ? 'Write every prompt and label in the same language the conversation has been using.'
    : `LANGUAGE OVERRIDE, applies to this answer only: write every prompt and label in ${language} — even if the transcript is in another language. Never copy the transcript's language here.`;
  return [
    'You suggest followup prompts the user of a coding-agent chat may want next. You answer with JSON only — no prose, no code fence.',
    `Output shape: {"followups":[{"prompt":"...","label":"..."}]} with exactly ${settings.maxFollowups} items.`,
    'Each prompt is one short sentence in the user\'s first-person voice, goal-oriented, standing alone without the transcript; each label is 2-5 words.',
    languageRule,
    'Good suggestions: alternatives to the latest change, related features, cleanup, tests, verification steps. If the transcript shows remaining plan steps, one suggestion may continue the next step.'
  ].join('\n');
}

function followupsFromModelText(text) {
  if (typeof text !== 'string' || text === '') return undefined;
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim());
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return undefined;
    try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return undefined; }
  }
  const followups = coerceFollowups(parsed);
  if (followups === undefined) return undefined;
  return followups.slice(0, 6).map((entry) => ({ prompt: String(entry.prompt).slice(0, 200), label: entry.label === null ? null : String(entry.label).slice(0, 40) }));
}

async function generateForTurn(ctx, settings, sessionId, afterSeq, signal) {
  const sessionQuery = get(ctx, 'sessionQuery');
  if (sessionQuery?.observeSession === undefined) throw new Error('the sessionQuery service is unavailable');
  const observation = await sessionQuery.observeSession(sessionId, { signal, projectionMode: 'none' });
  let transcript;
  try {
    const events = observation.events ?? [];
    const last = events.at(-1)?.event ?? events.at(-1);
    if (last?.type !== 'turn/end' || last.data?.reason?.kind !== 'completed' || last.seq !== afterSeq) {
      throw Object.assign(new Error('the chat moved on'), { status: 409 });
    }
    transcript = turnTranscript(events, afterSeq);
  } finally {
    observation[Symbol.dispose]?.();
  }
  if (transcript.trim() === '') return { followups: [] };
  const catalog = await modelCatalog(ctx);
  const route = settings.model !== ''
    ? (() => {
      const slash = settings.model.indexOf('/');
      const provider = settings.model.slice(0, slash);
      const model = settings.model.slice(slash + 1);
      if (catalog.groups.some((group) => group.id === provider && group.models.some((entry) => entry.id === model))) return { provider, model };
      throw Object.assign(new Error('the selected model is no longer listed'), { status: 409 });
    })()
    : catalog.default;
  if (route === undefined) throw Object.assign(new Error('no model is selected'), { status: 409 });
  const llm = get(ctx, 'llm');
  if (llm?.prepareCall === undefined) throw new Error('the llm service is unavailable');
  const timeout = AbortSignal.timeout(GENERATE_TIMEOUT_MS);
  const callSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  const call = await llm.prepareCall(route, callSignal, (controls, model) => {
    const cap = Number.isSafeInteger(model?.defaultMaxTokens) && model.defaultMaxTokens > 0 ? Math.min(GENERATE_MAX_TOKENS, model.defaultMaxTokens) : GENERATE_MAX_TOKENS;
    return { ...controls, maxTokens: cap };
  });
  let text = '';
  let finish;
  for await (const chunk of call.stream({ ...call.config, system: generateSystem(settings), signal: callSignal, messages: [{ role: 'user', content: [{ type: 'text', text: `<transcript>\n${transcript}\n</transcript>\n\nSuggest the followup prompts.` }] }] })) {
    if (chunk.type === 'text-delta') text += chunk.text;
    else if (chunk.type === 'finish') finish = chunk.reason;
  }
  if (finish?.kind === 'error' || finish?.kind === 'aborted') throw new Error(finish.failure?.message || `the model call ended: ${finish.kind}`);
  return { followups: followupsFromModelText(text) ?? [], model: route.model };
}

function newerVersion(latest, current) {
  for (let index = 0; index < 3; index += 1) {
    if ((latest[index] ?? 0) !== (current[index] ?? 0)) return (latest[index] ?? 0) > (current[index] ?? 0);
  }
  return false;
}

async function checkUpdate(fetchImpl = fetch, pkg = PACKAGE, signal) {
  const current = parseVersion(pkg.version);
  const managed = pkg.name === NPM_NAME && current !== undefined;
  const response = await fetchImpl(RELEASES_URL, { signal: signal === undefined ? AbortSignal.timeout(10000) : AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { accept: 'application/vnd.github+json', 'user-agent': NPM_NAME } });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const release = await response.json();
  const latest = parseVersion(release?.tag_name);
  if (latest === undefined) throw new Error('latest release has no x.y.z tag');
  const info = { name: NPM_NAME, current: pkg.version, latest: latest.join('.'), managed, newer: false, url: typeof release.html_url === 'string' && release.html_url.startsWith('https://github.com/') ? release.html_url : undefined };
  const notes = typeof release.body === 'string' ? release.body.slice(0, 4000) : undefined;
  if (notes !== undefined) info.notes = notes;
  if (current === undefined || !newerVersion(latest, current)) return info;
  const registry = await fetchImpl(`https://registry.npmjs.org/${NPM_NAME}/${info.latest}`, { signal: AbortSignal.any([signal ?? AbortSignal.timeout(10000), AbortSignal.timeout(10000)]) });
  return { ...info, newer: registry.ok };
}

async function apply(ctx) {
  let settings = settingsLoad();
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  const isExternal = (next) => typeof next.model === 'string' && next.model !== '';
  const reapplyTool = (next) => {
    settings = next;
    try {
      try { ctx.tools.unregister(TOOL_NAME); } catch { /* not registered yet */ }
      if (!isExternal(next)) ctx.tools.register(toolSpec());
    } catch (error) {
      console.error('dsh-nextsteps: tool re-registration failed:', error);
    }
  };
  try {
    if (!isExternal(settings)) ctx.tools.register(toolSpec());
  } catch (error) {
    console.error('dsh-nextsteps: tool registration failed:', error);
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['tools', 'systemPrompt'], (services) => {
      const [toolsService, systemPrompt] = services;
      try {
        try { toolsService.unregister(TOOL_NAME); } catch { /* not registered yet */ }
        if (!isExternal(settings)) toolsService.register(toolSpec());
      } catch (error) {
        console.error('dsh-nextsteps: tool registration via inject failed:', error);
      }
      try {
        systemPrompt.section({ name: 'dsh-nextsteps', order: 640, interpolate: false, text: () => nextstepsSectionText() });
      } catch (error) {
        console.error('dsh-nextsteps: system prompt section rejected:', error);
      }
    });
  }
  ctx.connection?.fetch?.register({
    path: '/api/dsh-nextsteps.settings',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'GET') return json({ ok: true, settings: settingsLoad(), version: PACKAGE.version });
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'bad request' }, 400); }
      const current = settingsLoad();
      const next = {
        lang: ["auto","en","pt-BR","zh-CN","es","fr","de","it","ja","ko","ru","ar","hi","id","tr","vi"].includes(body?.lang) ? body.lang : current.lang,
        maxFollowups: Number.isInteger(body?.maxFollowups) && body.maxFollowups >= 1 && body.maxFollowups <= 6 ? body.maxFollowups : current.maxFollowups,
        showHeader: typeof body?.showHeader === 'boolean' ? body.showHeader : current.showHeader,
        model: typeof body?.model === 'string' && body.model.includes('/') ? body.model : body?.model === '' || body?.model === undefined || body?.model === null ? '' : current.model
      };
      await settingsSave(next);
      reapplyTool(next);
      return json({ ok: true, settings: next });
    }
  });
  ctx.connection?.fetch?.register({
    path: '/api/dsh-nextsteps.models',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const catalog = await modelCatalog(ctx);
        return json({ ok: true, ...catalog });
      } catch (error) {
        return json({ error: String(error?.message ?? error) }, 502);
      }
    }
  });
  ctx.connection?.fetch?.register({
    path: '/api/dsh-nextsteps.generate',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
      if (typeof body?.sessionId !== 'string' || body.sessionId === '' || !Number.isSafeInteger(body?.afterSeq) || body.afterSeq < 0) {
        return json({ error: 'bad request' }, 400);
      }
      try {
        const result = await generateForTurn(ctx, settings, body.sessionId, body.afterSeq, request.signal);
        return json({ ok: true, rev: PLUGIN_REV, ...result });
      } catch (error) {
        const status = error?.status === 409 || error?.status === 400 ? error.status : 502;
        return json({ error: String(error?.message ?? error) }, status);
      }
    }
  });
  ctx.connection?.fetch?.register({
    path: '/api/dsh-nextsteps.update',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const info = await checkUpdate(fetch, PACKAGE, request.signal);
        return json({ ...info, installed: undefined });
      } catch (error) {
        return json({ error: String(error?.message ?? error) }, 502);
      }
    }
  });
}

export { name, inject, apply, checkUpdate };
