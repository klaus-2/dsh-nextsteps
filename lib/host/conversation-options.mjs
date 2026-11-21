// SPDX-License-Identifier: MIT

function legacyModelKey(stored) {
  if (stored === null || typeof stored !== 'object') return '';
  if (typeof stored.model === 'string') return stored.model.includes('/') ? stored.model : '';
  const provider = typeof stored.provider === 'string' ? stored.provider : '';
  const model = typeof stored.model === 'string' ? stored.model : '';
  return provider !== '' && model !== '' ? `${provider}/${model}` : '';
}

export function createConversationOptions({ languages, styleIds, cardActionIds, generationModes, constants, defaults: defaultOverrides }) {
  const {
    generateTimeoutMs,
    defaultMaxSuggestionChars,
    maxCustomInstructionChars,
    minLatencyBudgetMs,
    maxLatencyBudgetMs,
    minMaxSuggestionChars,
    maxMaxSuggestionChars
  } = constants;
  const latencyBudgetDefault = defaultOverrides?.latencyBudgetMs ?? generateTimeoutMs;

  function stylesOf(stored) {
    if (!Array.isArray(stored)) return undefined;
    const ids = [];
    for (const entry of stored) {
      if (typeof entry !== 'string') continue;
      if (!styleIds.includes(entry)) continue;
      if (ids.includes(entry)) continue;
      ids.push(entry);
    }
    if (ids.length === 0) return undefined;
    return ids;
  }

  function cardActionsOf(stored) {
    if (!Array.isArray(stored)) return undefined;
    const ids = [];
    for (const entry of stored) {
      if (typeof entry !== 'string' || !cardActionIds.includes(entry) || ids.includes(entry)) continue;
      ids.push(entry);
    }
    return ids;
  }

  const FIELDS = [
    {
      name: 'lang',
      validate: (value) => (languages.includes(value) ? value : undefined),
      override: (value) => (typeof value === 'string' && languages.includes(value) && value !== 'auto' ? value : undefined),
      fallback: 'auto',
      parity: { kind: 'enum', values: [...languages], default: 'auto' }
    },
    {
      name: 'maxFollowups',
      validate: (value) => (Number.isInteger(value) && value >= 1 && value <= 6 ? value : undefined),
      override: (value) => (Number.isInteger(value) && value >= 1 && value <= 6 ? value : undefined),
      fallback: 3,
      parity: { kind: 'int', min: 1, max: 6, default: 3 }
    },
    {
      name: 'showHeader',
      validate: (value) => value !== false,
      merge: (value, current) => (typeof value === 'boolean' ? value : current.showHeader),
      fallback: true,
      parity: { kind: 'bool', default: true }
    },
    {
      name: 'model',
      validate: (value, stored) => (typeof value === 'string' ? (value.includes('/') ? value : '') : legacyModelKey(stored)),
      merge: (value, current) => (typeof value === 'string' && value.includes('/') ? value : value === '' || value === undefined || value === null ? '' : current.model),
      override: (value) => (typeof value === 'string' && value.includes('/') ? value : undefined),
      fallback: '',
      parity: { kind: 'string', default: '' }
    },
    {
      name: 'fallbackModel',
      validate: (value) => value === true,
      merge: (value, current) => (typeof value === 'boolean' ? value : current.fallbackModel),
      fallback: false,
      parity: { kind: 'bool', default: false }
    },
    {
      name: 'styles',
      validate: stylesOf,
      fallback: () => [...styleIds],
      parity: { kind: 'enumList', values: [...styleIds], emptyDefault: true, default: [...styleIds] }
    },
    {
      name: 'generationMode',
      validate: (value) => (typeof value === 'string' && generationModes.includes(value) ? value : undefined),
      fallback: 'auto',
      parity: { kind: 'enum', values: [...generationModes], default: 'auto' }
    },
    {
      name: 'latencyBudgetMs',
      validate: (value) => (Number.isInteger(value) && value >= minLatencyBudgetMs && value <= maxLatencyBudgetMs ? value : undefined),
      fallback: latencyBudgetDefault,
      parity: { kind: 'int', min: minLatencyBudgetMs, max: maxLatencyBudgetMs, default: latencyBudgetDefault }
    },
    {
      name: 'maxSuggestionChars',
      validate: (value) => (Number.isInteger(value) && value >= minMaxSuggestionChars && value <= maxMaxSuggestionChars ? value : undefined),
      fallback: defaultMaxSuggestionChars,
      parity: { kind: 'int', min: minMaxSuggestionChars, max: maxMaxSuggestionChars, default: defaultMaxSuggestionChars }
    },
    {
      name: 'retentionDays',
      validate: (value) => (Number.isInteger(value) && value >= 0 && value <= 365 ? value : undefined),
      fallback: 0,
      parity: { kind: 'int', min: 0, max: 365, default: 0 }
    },
    {
      name: 'transcriptScope',
      validate: (value) => (value === 'minimal' ? 'minimal' : value === 'full' ? 'full' : undefined),
      fallback: 'full',
      parity: { kind: 'enum', values: ['full', 'minimal'], default: 'full' }
    },
    {
      name: 'customInstruction',
      validate: (value) => (typeof value === 'string' ? value.trim().slice(0, maxCustomInstructionChars) : undefined),
      override: (value) => (typeof value === 'string' ? value.trim().slice(0, maxCustomInstructionChars) : ''),
      fallback: '',
      parity: { kind: 'string', maxChars: maxCustomInstructionChars, default: '' }
    },
    {
      name: 'confirmBeforeSend',
      validate: (value) => value === true,
      merge: (value, current) => (typeof value === 'boolean' ? value : current.confirmBeforeSend),
      fallback: false,
      parity: { kind: 'bool', default: false }
    },
    {
      name: 'cardActions',
      validate: cardActionsOf,
      fallback: () => [...cardActionIds],
      parity: { kind: 'enumList', values: [...cardActionIds], emptyDefault: false, default: [...cardActionIds] }
    }
  ];

  function freshValue(fallback) {
    return typeof fallback === 'function' ? fallback() : fallback;
  }

  function defaults() {
    const out = {};
    for (const entry of FIELDS) {
      out[entry.name] = freshValue(entry.fallback);
    }
    return out;
  }

  function normalize(raw) {
    const stored = raw ?? {};
    const out = {};
    for (const entry of FIELDS) {
      out[entry.name] = entry.validate(stored[entry.name], stored) ?? freshValue(entry.fallback);
    }
    return out;
  }

  function merge(current, patch) {
    const body = patch ?? {};
    const out = {};
    for (const entry of FIELDS) {
      const value = body[entry.name];
      out[entry.name] = entry.merge !== undefined
        ? entry.merge(value, current)
        : (entry.validate(value) ?? current[entry.name]);
    }
    return out;
  }

  function sanitizeOverride(patch) {
    const body = patch ?? {};
    const out = {};
    for (const entry of FIELDS) {
      if (entry.override === undefined) continue;
      const value = entry.override(body[entry.name]);
      if (value !== undefined) out[entry.name] = value;
    }
    return out;
  }

  return { fields: FIELDS, defaults, normalize, merge, sanitizeOverride };
}
