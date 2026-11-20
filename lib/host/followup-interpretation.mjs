// SPDX-License-Identifier: MIT

export function createFollowupInterpretation({ styleIds, defaultMaxChars, maxFollowupsOf }) {
  function coerceFollowups(raw) {
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        return undefined;
      }
    }
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      try {
        if (Array.isArray(raw.followups)) raw = raw.followups;
      } catch {
        return undefined;
      }
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
      return `Error: \`followups\` must be a non-empty array (aim for ${maxFollowupsOf()}) of objects with a non-empty \`prompt\` string and an optional short \`label\` string. Received ${shape}. Retry with valid followups.`;
    }
    for (const followup of followups) {
      if (followup === null || typeof followup !== 'object') {
        return 'Error: each followup must be an object with a non-empty `prompt` string. Retry with valid followups.';
      }
      let prompt;
      let label;
      try {
        prompt = followup.prompt;
        label = followup.label;
      } catch {
        return 'Error: each followup must be an object with a non-empty `prompt` string. Retry with valid followups.';
      }
      if (typeof prompt !== 'string' || prompt.trim() === '') {
        return 'Error: each followup needs a non-empty `prompt` string (the message sent when the user clicks). Retry with valid followups.';
      }
      if (label !== undefined && (typeof label !== 'string' || label.trim() === '')) {
        return 'Error: `label` must be a short non-empty string when present. Retry with valid followups.';
      }
    }
    return null;
  }

  function salvageFollowups(text) {
    const objects = [];
    const opens = [];
    let inString = false;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') {
        opens.push(index);
        continue;
      }
      if (char === '}') {
        const open = opens.pop();
        if (open === undefined) continue;
        objects.push(text.slice(open, index + 1));
      }
    }
    const items = [];
    for (const candidate of objects) {
      let item;
      try {
        item = JSON.parse(candidate);
      } catch {
        continue;
      }
      if (item === null || typeof item !== 'object' || typeof item.prompt !== 'string' || item.prompt.trim() === '') continue;
      items.push(item);
    }
    return items;
  }

  function followupsFromModelText(text, maxChars = defaultMaxChars) {
    if (typeof text !== 'string' || text === '') return undefined;
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim());
    } catch {
      parsed = undefined;
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { parsed = undefined; }
      }
      if (parsed === undefined) {
        const salvaged = salvageFollowups(text);
        if (salvaged.length > 0) parsed = salvaged;
      }
    }
    const followups = coerceFollowups(parsed);
    if (followups === undefined) return undefined;
    const cap = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : defaultMaxChars;
    return followups
      .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.prompt === 'string' && entry.prompt.trim() !== '')
      .slice(0, 6)
      .map((entry) => ({
        prompt: entry.prompt.slice(0, cap),
        label: typeof entry.label === 'string' && entry.label.trim() !== '' ? entry.label.slice(0, 40) : null,
        ...(typeof entry.style === 'string' && styleIds.includes(entry.style) ? { style: entry.style } : {})
      }));
  }

  const NO_USABLE_PROBLEM = 'Error: the reply contains no usable followups JSON. Retry with valid followups.';

  function interpret({ source, value, maxChars, maxFollowups }) {
    if (source !== 'tool-args' && source !== 'model-text' && source !== 'fixture') {
      throw new TypeError('unknown followup interpretation source: ' + source);
    }
    const count = Number.isInteger(maxFollowups) && maxFollowups >= 1 ? maxFollowups : maxFollowupsOf();
    if (source === 'tool-args') {
      const followups = coerceFollowups(value);
      const problem = validationProblem(followups);
      if (problem !== null) return { ok: false, problem };
      return { ok: true, followups };
    }
    const parsed = followupsFromModelText(value, maxChars);
    if (parsed === undefined) return { ok: false, problem: NO_USABLE_PROBLEM };
    return { ok: true, followups: parsed.slice(0, count) };
  }

  return { interpret, coerceFollowups, validationProblem, followupsFromModelText };
}
