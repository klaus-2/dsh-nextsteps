// SPDX-License-Identifier: MIT
window.__ModuleLoader__.load({
  id: 'dsh-nextsteps',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-nextsteps';
    const TOOL_NAME = 'suggest_followups';
    const MAX_FOLLOWUPS = 6;
    const PROMPT_TRUNCATE = 60;
    const STYLE_IDS = ['next-action', 'explore', 'deep-dive'];
    const GENERATION_MODES = ['auto', 'on-demand'];
    const LATENCY_MIN_MS = 5000;
    const LATENCY_MAX_MS = 120000;
    const LATENCY_DEFAULT_MS = 30000;
    const CHARS_MIN = 60;
    const CHARS_MAX = 600;
    const CHARS_DEFAULT = 200;
    const CAPTURE_LIMIT = 400;
    const METRIC_SAMPLES = 50;
    const WRITE_RETRY_DELAYS_MS = [250, 1000, 4000];
    const RETRY_DELAY_MS = 1200;
    const GENERATION_ATTEMPTS = 2;
    const CLICKED_KEY = 'dsh-nextsteps.clicked';
    const DRAG_THRESHOLD_PX = 6;
    const CONFIRM_RESET_MS = 4000;
    const UPDATE_KEY = 'dsh-nextsteps.updated';
    const CAPTURES_INDEX_KEY = 'dsh-nextsteps.captures.index';
    const CAPTURE_SESSION_KEY = 'dsh-nextsteps.captures.session';
    const FAVORITES_KEY = 'dsh-nextsteps.favorites';
    const FAVORITES_ORDER_KEY = 'dsh-nextsteps.favorites-order';
    const DISCARDED_KEY = 'dsh-nextsteps.discarded';
    const METRICS_KEY = 'dsh-nextsteps.metrics';
    const CAPTURES_KEY = 'dsh-nextsteps.captures.v1';
    const SESSION_OVERRIDES_KEY = 'dsh-nextsteps.session-overrides';
    const PRIVATE_KEY = 'dsh-nextsteps.private-sessions';
    const AUDIT_KEY = 'dsh-nextsteps.audit.v1';
    const CARD_ORDER_KEY = 'dsh-nextsteps.card-order';
    const CARD_ORDER_LIMIT = 40;
    const AUDIT_LIMIT = 200;

    const API_PORTS = [47497, 47498, 47499, 47500, 47501, 47502, 47503, 47504, 47505, 47506, 47507, 47508, 47509, 47510, 47511, 47512, 47513, 47514, 47515, 47516];
    const HEALTH_TIMEOUT_MS = 1000;
    const SECRET_TIMEOUT_MS = 5000;
    const UPDATE_TIMEOUT_MS = 15000;
    let API_BASE = 'http://127.0.0.1:47497';
    let identifiedApiBase = '';
    let apiDiscovery = null;
    const SECRET_ROUTE = '/api/dsh-nextsteps.secret';
    const SECRET_HEADER = 'x-dsh-nextsteps-secret';
    let INSTANCE_SECRET = '';

    const versionOf = (text) => { const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(text ?? '')); return m === null ? undefined : m.slice(1).map(Number); };
    const compareVersions = (a, b) => { const pa = versionOf(a); const pb = versionOf(b); if (pa === undefined || pb === undefined) return 0; for (let i = 0; i < 3; i += 1) { if (pa[i] !== pb[i]) return pa[i] - pb[i]; } return 0; };
    const isNewer = (candidate, running) => versionOf(candidate) !== undefined && versionOf(running) !== undefined && compareVersions(candidate, running) > 0;

    async function resolveInstanceSecret() {
      if (INSTANCE_SECRET !== '') return INSTANCE_SECRET;
      try {
        console.info('dsh-nextsteps: requesting ' + SECRET_ROUTE);
        const r = await fetch(SECRET_ROUTE, { cache: 'no-store', signal: AbortSignal.timeout(SECRET_TIMEOUT_MS) });
        const j = await r.json();
        if (j && j.ok && typeof j.secret === 'string' && j.secret !== '') {
          INSTANCE_SECRET = j.secret;
          console.info('dsh-nextsteps: secret acquired');
        } else {
          console.info('dsh-nextsteps: the secret route answered ok=' + (j?.ok === true));
        }
      } catch (error) {
        console.info('dsh-nextsteps: the secret request failed ' + describeError(error));
      }
      return INSTANCE_SECRET;
    }

    function authHeaders(extra) {
      if (identifiedApiBase === '' || identifiedApiBase !== API_BASE) throw new Error('the Nextsteps host has not been identified');
      const headers = { ...(extra ?? {}) };
      if (INSTANCE_SECRET !== '') headers[SECRET_HEADER] = INSTANCE_SECRET;
      return headers;
    }

    async function resolveApiBase() {
      if (identifiedApiBase !== '') return identifiedApiBase;
      if (apiDiscovery === null) {
        apiDiscovery = (async () => {
          console.info('dsh-nextsteps: api discovery: probing ports...');
          for (const port of API_PORTS) {
            try {
              const r = await fetch(`http://127.0.0.1:${port}/.ns/health`, { cache: 'no-store', signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
              if (!r.ok) continue;
              const j = await r.json().catch(() => null);
              if (j === null || j.ok !== true || j.name !== NS || j.port !== port) continue;
              console.info(`dsh-nextsteps: api discovery: host found on :${port}, fetching secret...`);
              if (await resolveInstanceSecret() === '') {
                console.info(`dsh-nextsteps: api discovery: host on :${port} ok but the secret is unavailable`);
                apiDiscovery = null;
                return null;
              }
              API_BASE = `http://127.0.0.1:${port}`;
              identifiedApiBase = API_BASE;
              console.info(`dsh-nextsteps: api discovery: identified base ${API_BASE}`);
              return API_BASE;
            } catch {}
          }
          console.info('dsh-nextsteps: api discovery: no host found in the port range');
          apiDiscovery = null;
          return null;
        })();
      }
      return apiDiscovery;
    }

    const remembered = () => { try { return localStorage.getItem(UPDATE_KEY) ?? ''; } catch { return ''; } };
    const remember = (value) => { try { localStorage.setItem(UPDATE_KEY, value); } catch {} };
    const forget = () => { try { localStorage.removeItem(UPDATE_KEY); } catch {} };

    const CSS = `
.dsh-sf-root { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.dsh-sf-header { font-size: 11px; letter-spacing: 0.02em; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsh-sf-header-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-sf-row { display: flex; flex-wrap: wrap; gap: 8px; }
.dsh-sf-item { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; max-width: 100%; }
.dsh-sf-grip { cursor: grab; touch-action: none; flex: none; user-select: none; }
.dsh-sf-cardline { display: flex; align-items: center; gap: 4px; max-width: 100%; min-width: 0; }
.dsh-sf-cardline.is-dragging { opacity: 0.5; }
.dsh-sf-item-actions { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
.dsh-sf-item:hover .dsh-sf-item-actions, .dsh-sf-item:focus-within .dsh-sf-item-actions { opacity: 1; pointer-events: auto; }
@media (hover: none) { .dsh-sf-item-actions { opacity: 1; pointer-events: auto; } }
.dsh-sf-card { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; font: inherit; font-size: 12.5px; line-height: 1.45; padding: 6px 12px; border-radius: var(--dsw-radius-md, 10px); border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; transition: border-color 120ms ease, background 120ms ease, transform 60ms ease; }
.dsh-sf-card:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-brand-primary); }
.dsh-sf-card:hover:not(:disabled) .dsh-sf-icon { color: var(--dsw-alias-brand-primary); }
.dsh-sf-card:active:not(:disabled) { transform: translateY(1px); }
.dsh-sf-card:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-sf-card:disabled { cursor: default; opacity: 0.6; }
.dsh-sf-icon { flex: none; color: var(--dsw-alias-label-secondary); font-size: 12px; transition: color 120ms ease; }
.dsh-sf-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-sf-card.is-sent { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); background: transparent; }
.dsh-sf-card.is-sent .dsh-sf-icon { color: var(--dsw-alias-state-success-primary); }
.dsh-sf-actions { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dsh-sf-action { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; padding: 2px 6px; font: inherit; font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary); background: transparent; border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 10px); cursor: pointer; }
.dsh-sf-action:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.dsh-sf-action:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-sf-prompt { max-width: 100%; font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-sf-editor { display: flex; flex-direction: column; gap: 6px; max-width: 100%; }
.dsh-sf-textarea { min-height: 56px; max-width: 100%; font: inherit; font-size: 12px; line-height: 1.45; padding: 6px 8px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 10px); resize: vertical; }
.dsh-sf-notice { max-width: 100%; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-sf-hints { display: none; font-size: 10px; letter-spacing: 0.02em; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsh-sf-item:focus-within .dsh-sf-hints { display: inline-flex; gap: 8px; }
.dsh-sf-placeholder { font-size: 11px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsh-sf-manual { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.dsh-sf-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.dsh-sf-error { max-width: 100%; color: var(--dsw-alias-state-error-primary); font-size: 12px; }
.dsh-sf-generating { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-sf-charcount { font-size: 11px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsh-sf-charcount-over { color: var(--dsw-alias-state-error-primary); }
.dsh-sf-confirm { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; max-width: 100%; }
.dsh-sf-origin { font-size: 10px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsh-sf-warn { color: var(--dsw-alias-state-warning-primary, #f5a623); font-size: 12px; }
`;

    function installStyles(ctx) {
      try {
        const styles = ctx.get('styles');
        if (styles !== undefined && styles !== null && typeof styles.insert === 'function') {
          styles.insert(CSS);
          return;
        }
      } catch (error) {
        console.warn('dsh-nextsteps: styles service unavailable:', error);
      }
      try {
        const tag = document.createElement('style');
        tag.textContent = CSS;
        document.head.appendChild(tag);
      } catch (error) {
        console.warn('dsh-nextsteps: could not install styles:', error);
      }
    }

    const captureCache = new Map();
    let capturesIndex = null;
    const captureListeners = new Set();
    const discardListeners = new Set();
    const sessionOverrideListeners = new Set();
    const pendingWrites = new Map();
    let writeTimer = null;

    function readStorage(key) {
      try {
        return window.localStorage.getItem(key);
      } catch (error) {
        console.warn('dsh-nextsteps: could not read ' + key + ':', error);
        return null;
      }
    }

    function readJson(key, fallback) {
      const raw = readStorage(key);
      if (raw === null) return fallback;
      try {
        const parsed = JSON.parse(raw);
        return parsed === null ? fallback : parsed;
      } catch (error) {
        console.warn('dsh-nextsteps: could not parse ' + key + ':', error);
        return fallback;
      }
    }

    function writeNow(key, value) {
      try {
        window.localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }

    function removeNow(key) {
      try {
        window.localStorage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    }

    function scheduleFlush(delay) {
      if (writeTimer !== null) return;
      writeTimer = window.setTimeout(() => {
        writeTimer = null;
        flushPendingWrites();
      }, delay);
    }

    function scheduleWrite(key, value) {
      const pending = pendingWrites.get(key);
      if (pending === undefined) {
        pendingWrites.set(key, { value, remove: false, attempt: 0, nextAt: 0 });
      } else {
        pending.value = value;
        pending.remove = false;
      }
      scheduleFlush(0);
    }

    function scheduleRemove(key) {
      const pending = pendingWrites.get(key);
      if (pending === undefined) {
        pendingWrites.set(key, { value: null, remove: true, attempt: 0, nextAt: 0 });
      } else {
        pending.value = null;
        pending.remove = true;
      }
      scheduleFlush(0);
    }

    function flushPendingWrites() {
      if (pendingWrites.size === 0) return;
      const now = Date.now();
      let nextDelay = 0;
      const dropped = [];
      for (const [key, pending] of [...pendingWrites.entries()]) {
        if (pending.nextAt > now) {
          const wait = pending.nextAt - now;
          if (nextDelay === 0 || wait < nextDelay) nextDelay = wait;
          continue;
        }
        let written = false;
        try {
          if (pending.remove === true) window.localStorage.removeItem(key);
          else window.localStorage.setItem(key, pending.value);
          written = true;
        } catch {
          written = false;
        }
        if (written) {
          pendingWrites.delete(key);
          continue;
        }
        const delay = WRITE_RETRY_DELAYS_MS[pending.attempt];
        if (delay === undefined) {
          pendingWrites.delete(key);
          dropped.push(key);
          continue;
        }
        pending.attempt += 1;
        pending.nextAt = now + delay;
        if (nextDelay === 0 || delay < nextDelay) nextDelay = delay;
      }
      if (dropped.length > 0) console.warn('dsh-nextsteps: the capture store could not be written:', dropped.join(', '));
      if (pendingWrites.size === 0) return;
      scheduleFlush(nextDelay);
    }

    function flushWrites() {
      if (writeTimer !== null) {
        window.clearTimeout(writeTimer);
        writeTimer = null;
      }
      flushPendingWrites();
    }

    const privateSessions = new Set();
    let privateLoaded = false;
    const privateClicked = new Set();

    function readPrivateSessions() {
      if (privateLoaded) return privateSessions;
      privateLoaded = true;
      const parsed = readJson(PRIVATE_KEY, {});
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const sessionId of Object.keys(parsed)) {
          if (typeof sessionId === 'string' && sessionId !== '') privateSessions.add(sessionId);
        }
      }
      return privateSessions;
    }

    function isPrivateSession(sessionId) {
      return readPrivateSessions().has(sessionId);
    }

    function purgeSessionRecords(sessionId) {
      let residue = false;
      const writeThrough = (key, payload) => {
        if (payload === null) {
          pendingWrites.delete(key);
          if (removeNow(key)) return true;
          scheduleRemove(key);
          return false;
        }
        if (writeNow(key, payload)) {
          pendingWrites.delete(key);
          return true;
        }
        scheduleWrite(key, payload);
        return false;
      };
      const index = readIndex();
      if (index.sessions[sessionId] !== undefined) {
        removeSession(index, sessionId);
        residue = !writeThrough(CAPTURES_INDEX_KEY, JSON.stringify(index)) || residue;
      }
      residue = !writeThrough(CAPTURE_SESSION_KEY + '.' + sessionId, null) || residue;
      const sid = contentHash(sessionId);
      const auditEntries = storeStateForWrite(AUDIT_KEY, readAudit, []);
      const auditKept = auditEntries.filter((entry) => entry.sid !== sid);
      if (auditKept.length !== auditEntries.length) {
        residue = !writeThrough(AUDIT_KEY, auditKept.length === 0 ? null : JSON.stringify(auditKept.slice(-AUDIT_LIMIT))) || residue;
      }
      const discardEntries = Object.entries(storeStateForWrite(DISCARDED_KEY, readDiscarded, {}));
      const discardKept = discardEntries.filter(([, value]) => value === null || typeof value !== 'object' || value.sessionId !== sessionId);
      if (discardKept.length !== discardEntries.length) {
        let payload = null;
        if (discardKept.length > 0) {
          const kept = {};
          for (const [key, value] of discardKept) kept[key] = value;
          payload = JSON.stringify(kept);
        }
        residue = !writeThrough(DISCARDED_KEY, payload) || residue;
      }
      const legacy = storeStateForWrite(CAPTURES_KEY, () => {
        const parsed = readJson(CAPTURES_KEY, null);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      }, {});
      if (legacy[sessionId] !== undefined) {
        delete legacy[sessionId];
        residue = !writeThrough(CAPTURES_KEY, Object.keys(legacy).length === 0 ? null : JSON.stringify(legacy)) || residue;
      }
      return residue;
    }

    function writePrivateSession(sessionId, on) {
      const next = readPrivateSessions();
      let residue = false;
      if (on) {
        next.add(sessionId);
        residue = purgeSessionRecords(sessionId) === true;
      } else next.delete(sessionId);
      const payload = {};
      for (const id of next) payload[id] = true;
      if (Object.keys(payload).length === 0) scheduleRemove(PRIVATE_KEY);
      else scheduleWrite(PRIVATE_KEY, JSON.stringify(payload));
      return residue;
    }

    function readSessionOverrides() {
      const parsed = readJson(SESSION_OVERRIDES_KEY, {});
      const overrides = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      const clean = {};
      for (const [sessionId, entry] of Object.entries(overrides)) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const sanitized = {};
        if (entry.lang === '' || (typeof entry.lang === 'string' && LANGUAGE_OPTIONS.some((option) => option.value === entry.lang))) sanitized.lang = entry.lang;
        if (Number.isInteger(entry.maxFollowups) && entry.maxFollowups >= 1 && entry.maxFollowups <= 6) sanitized.maxFollowups = entry.maxFollowups;
        if (typeof entry.model === 'string' && entry.model.includes('/')) sanitized.model = entry.model;
        if (sanitized.lang !== undefined || sanitized.maxFollowups !== undefined || sanitized.model !== undefined) clean[sessionId] = sanitized;
      }
      return clean;
    }

    function sessionOverrideOf(sessionId) {
      return readSessionOverrides()[sessionId];
    }

    function writeSessionOverride(sessionId, patch) {
      const overrides = readSessionOverrides();
      const merged = { ...(overrides[sessionId] ?? {}) };
      for (const [field, value] of Object.entries(patch)) {
        if (value === undefined || value === '' || value === null) delete merged[field];
        else if (field === 'lang' && typeof value === 'string' && LANGUAGE_OPTIONS.some((option) => option.value === value)) merged.lang = value;
        else if (field === 'maxFollowups' && Number.isInteger(value) && value >= 1 && value <= 6) merged.maxFollowups = value;
        else if (field === 'model' && typeof value === 'string' && value.includes('/')) merged.model = value;
      }
      if (Object.keys(merged).length === 0) {
        clearSessionOverride(sessionId);
        return;
      }
      const payload = JSON.stringify({ ...overrides, [sessionId]: merged });
      if (!writeNow(SESSION_OVERRIDES_KEY, payload)) scheduleWrite(SESSION_OVERRIDES_KEY, payload);
      else pendingWrites.delete(SESSION_OVERRIDES_KEY);
      for (const listener of sessionOverrideListeners) listener(sessionId);
    }

    function clearSessionOverride(sessionId) {
      const overrides = readSessionOverrides();
      if (overrides[sessionId] === undefined) {
        for (const listener of sessionOverrideListeners) listener(sessionId);
        return;
      }
      delete overrides[sessionId];
      if (Object.keys(overrides).length === 0) {
        if (!removeNow(SESSION_OVERRIDES_KEY)) scheduleRemove(SESSION_OVERRIDES_KEY);
        else pendingWrites.delete(SESSION_OVERRIDES_KEY);
      } else {
        const payload = JSON.stringify(overrides);
        if (!writeNow(SESSION_OVERRIDES_KEY, payload)) scheduleWrite(SESSION_OVERRIDES_KEY, payload);
        else pendingWrites.delete(SESSION_OVERRIDES_KEY);
      }
      for (const listener of sessionOverrideListeners) listener(sessionId);
    }

    function readCardOrder() {
      const parsed = readJson(CARD_ORDER_KEY, {});
      const order = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      const clean = {};
      for (const [orderKey, itemIds] of Object.entries(order)) {
        if (typeof orderKey !== 'string' || !orderKey.includes('|')) continue;
        if (!Array.isArray(itemIds) || itemIds.some((id) => typeof id !== 'string' || id === '')) continue;
        clean[orderKey] = itemIds;
      }
      return clean;
    }

    function writeCardOrder(orderKey, itemIds) {
      if (typeof orderKey !== 'string') return;
      const next = readCardOrder();
      next[orderKey] = itemIds;
      while (Object.keys(next).length > CARD_ORDER_LIMIT) delete next[Object.keys(next)[0]];
      scheduleWrite(CARD_ORDER_KEY, JSON.stringify(next));
    }

    function readIndex() {
      if (capturesIndex !== null) return capturesIndex;
      const index = { order: [], sessions: {} };
      const parsed = readJson(CAPTURES_INDEX_KEY, null);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const order = Array.isArray(parsed.order) ? parsed.order.filter((id) => typeof id === 'string') : [];
        const sessions = parsed.sessions !== null && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions) ? parsed.sessions : {};
        index.order = order;
        index.sessions = sessions;
      }
      capturesIndex = index;
      return capturesIndex;
    }

    function registerSession(index, sessionId) {
      if (index.sessions[sessionId] === undefined) {
        index.sessions[sessionId] = {};
        index.order.push(sessionId);
      }
      return index.sessions[sessionId];
    }

    function removeSession(index, sessionId) {
      delete index.sessions[sessionId];
      const at = index.order.indexOf(sessionId);
      if (at !== -1) index.order.splice(at, 1);
    }

    function migrateLegacyCaptures() {
      const raw = readStorage(CAPTURES_KEY);
      if (raw === null) return;
      let store = null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) store = parsed;
      } catch (error) {
        console.warn('dsh-nextsteps: the legacy capture store could not be read:', error);
        return;
      }
      if (store === null) {
        console.warn('dsh-nextsteps: the legacy capture store has an unexpected shape; it is left untouched');
        return;
      }
      const pendingPrivate = Object.keys(store).filter((sessionId) => {
        const entries = store[sessionId];
        return entries !== null && typeof entries === 'object' && !Array.isArray(entries) && Object.keys(entries).length > 0 && isPrivateSession(sessionId);
      });
      if (pendingPrivate.length > 0) {
        console.warn('dsh-nextsteps: the legacy capture migration is deferred while a private session still holds pending entries');
        return;
      }
      const index = readIndex();
      let migrated = true;
      for (const [sessionId, sessionEntries] of Object.entries(store)) {
        if (sessionEntries === null || typeof sessionEntries !== 'object' || Array.isArray(sessionEntries)) continue;
        const entries = {};
        for (const [callId, entry] of Object.entries(sessionEntries)) {
          if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.followups) || entry.followups.length === 0) continue;
          entries[callId] = { turn: entry.turn === undefined ? undefined : turnIdOf(entry.turn), followups: entry.followups, clickedId: entry.clickedId, origin: originOf(entry.origin), at: typeof entry.at === 'number' ? entry.at : undefined };
        }
        if (Object.keys(entries).length === 0) continue;
        if (writeNow(CAPTURE_SESSION_KEY + '.' + sessionId, JSON.stringify(entries)) === false) {
          migrated = false;
          console.warn('dsh-nextsteps: the legacy capture store could not be migrated:', sessionId);
          continue;
        }
        const calls = registerSession(index, sessionId);
        for (const [callId, entry] of Object.entries(entries)) calls[callId] = entry.turn ?? null;
      }
      if (migrated === false) return;
      removeNow(CAPTURES_KEY);
      writeNow(CAPTURES_INDEX_KEY, JSON.stringify(index));
    }

    function capturesFor(sessionId) {
      const cached = captureCache.get(sessionId);
      if (cached !== undefined) return cached;
      const entries = new Map();
      const parsed = readJson(CAPTURE_SESSION_KEY + '.' + sessionId, null);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [callId, entry] of Object.entries(parsed)) {
          if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.followups) || entry.followups.length === 0) continue;
          entries.set(callId, { turn: entry.turn === undefined ? undefined : turnIdOf(entry.turn), followups: entry.followups, clickedId: entry.clickedId, origin: originOf(entry.origin), at: typeof entry.at === 'number' ? entry.at : undefined });
        }
      }
      captureCache.set(sessionId, entries);
      return entries;
    }

    function pruneCaptures(index) {
      const touched = new Set();
      let total = 0;
      for (const sessionId of index.order) {
        const calls = index.sessions[sessionId];
        if (calls === undefined) continue;
        total += Object.keys(calls).length;
      }
      if (total <= CAPTURE_LIMIT) return touched;
      for (const sessionId of [...index.order]) {
        if (total <= CAPTURE_LIMIT) break;
        const calls = index.sessions[sessionId];
        if (calls === undefined) continue;
        const entries = capturesFor(sessionId);
        for (const callId of Object.keys(calls)) {
          if (total <= CAPTURE_LIMIT) break;
          delete calls[callId];
          entries.delete(callId);
          total -= 1;
          touched.add(sessionId);
        }
        if (Object.keys(calls).length === 0) {
          removeSession(index, sessionId);
          touched.add(sessionId);
        }
      }
      return touched;
    }

    function pruneExpiredCaptures(index, retentionDays) {
      const touched = new Set();
      if (!Number.isInteger(retentionDays) || retentionDays <= 0) return touched;
      const cutoff = Date.now() - retentionDays * 86400000;
      const favorites = readFavorites();
      for (const sessionId of [...index.order]) {
        const calls = index.sessions[sessionId];
        if (calls === undefined) continue;
        const entries = capturesFor(sessionId);
        let removed = false;
        for (const callId of Object.keys(calls)) {
          const entry = entries.get(callId);
          const at = typeof entry?.at === 'number' ? entry.at : (typeof entry?.origin?.at === 'number' ? entry.origin.at : undefined);
          if (at === undefined || at > cutoff) continue;
          const protectedByFavorite = Array.isArray(entry.followups) && entry.followups.some((followup) => {
            const hash = typeof followup?.prompt === 'string' ? favorites[contentHash(followup.prompt)] : undefined;
            return hash !== undefined;
          });
          if (protectedByFavorite) continue;
          delete calls[callId];
          entries.delete(callId);
          removed = true;
          touched.add(sessionId);
        }
        if (removed && Object.keys(calls).length === 0) removeSession(index, sessionId);
      }
      return touched;
    }

    function persistCaptures(sessionId, index, touched) {
      const sessions = new Set(touched ?? []);
      sessions.add(sessionId);
      for (const id of sessions) {
        const key = CAPTURE_SESSION_KEY + '.' + id;
        const entries = captureCache.get(id);
        if (entries === undefined) {
          continue;
        }
        if (entries.size === 0) {
          scheduleRemove(key);
          continue;
        }
        const payload = {};
        for (const [callId, entry] of entries) payload[callId] = entry;
        scheduleWrite(key, JSON.stringify(payload));
      }
      scheduleWrite(CAPTURES_INDEX_KEY, JSON.stringify(index));
    }

    function rememberCapture(sessionId, callId, turn, followups, origin) {
      if (followups === null || followups === undefined) return;
      const started = Date.now();
      const entries = capturesFor(sessionId);
      const previous = entries.get(callId);
      const mergedTurn = turnIdOf(turn) ?? previous?.turn;
      const clickedId = previous?.clickedId
        ?? `sf-${contentHash(`${sessionId}|${mergedTurn ?? callId}|${callId}|${followups.map((entry) => entry.prompt).join('|')}`)}`;
      entries.set(callId, { turn: mergedTurn, followups, clickedId, origin: originOf(origin) ?? originOf(previous?.origin), at: previous?.at ?? Date.now() });
      if (isPrivateSession(sessionId)) {
        recordMetric('persistence', Date.now() - started);
        for (const listener of captureListeners) listener(sessionId);
        return;
      }
      const auditOrigin = originOf(origin) ?? originOf(previous?.origin);
      if (auditOrigin?.source !== 'fixture') recordAudit('generated', followups.map((entry) => entry.prompt).join('|'), sessionId);
      const index = readIndex();
      const calls = registerSession(index, sessionId);
      calls[callId] = mergedTurn ?? null;
      const touched = pruneExpiredCaptures(index, pluginSettings.retentionDays);
      for (const expiredSessionId of pruneCaptures(index)) touched.add(expiredSessionId);
      persistCaptures(sessionId, index, touched);
      recordMetric('persistence', Date.now() - started);
      for (const listener of captureListeners) listener(sessionId);
    }

    function capturesForTurn(sessionId, turn) {
      const entries = capturesFor(sessionId);
      const host = hostModeFor(sessionId);
      const onDemand = pluginSettings.generationMode === 'on-demand';
      const generated = [];
      const manual = [];
      for (const [callId, entry] of entries.entries()) {
        if (entry.turn !== turn) continue;
        if ((host || onDemand) && !callId.startsWith('generated-') && !callId.startsWith('manual-')) continue;
        if (callId.startsWith('manual-')) manual.push(entry);
        else generated.push(entry);
      }
      return generated.concat(manual);
    }

    function newestCapture(sessionId) {
      const entries = capturesFor(sessionId);
      let best = null;
      for (const entry of entries.values()) {
        if (best === null || (entry.turn ?? -1) > (best.turn ?? -1)) best = entry;
      }
      return best;
    }

    const adoptedCallIds = new Set();

    function unclaimedCaptures(sessionId, turn) {
      const entries = capturesFor(sessionId);
      const candidates = [];
      for (const [callId, entry] of entries.entries()) {
        if (entry.turn === undefined && !adoptedCallIds.has(callId)) candidates.push([callId, entry]);
      }
      if (candidates.length === 0) return null;
      candidates.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      const [callId, entry] = candidates[0];
      adoptedCallIds.add(callId);
      entries.set(callId, { ...entry, turn });
      if (isPrivateSession(sessionId)) return entry;
      const index = readIndex();
      const calls = registerSession(index, sessionId);
      calls[callId] = turn ?? null;
      const touched = pruneCaptures(index);
      persistCaptures(sessionId, index, touched);
      return entry;
    }

    function manualCountFor(sessionId, turn) {
      const entries = capturesFor(sessionId);
      const prefix = 'manual-' + turn + '-';
      let count = 0;
      for (const callId of entries.keys()) {
        if (callId.startsWith(prefix)) count += 1;
      }
      return count;
    }

    function readClickedMap() {
      try {
        const raw = window.localStorage.getItem(CLICKED_KEY);
        const parsed = raw === null ? {} : JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' ? parsed : {};
      } catch (error) {
        console.warn('dsh-nextsteps: could not read clicked state:', error);
        return {};
      }
    }

    function markClicked(clickedId) {
      const clicked = readClickedMap();
      clicked[clickedId] = true;
      scheduleWrite(CLICKED_KEY, JSON.stringify(clicked));
    }

    function readAudit() {
      const parsed = readJson(AUDIT_KEY, []);
      return Array.isArray(parsed)
        ? parsed.filter((entry) => entry !== null && typeof entry === 'object' && (entry.kind === 'generated' || entry.kind === 'sent') && typeof entry.hash === 'string' && typeof entry.at === 'number')
        : [];
    }

    function storeStateForWrite(key, readStore, emptyState) {
      const pending = pendingWrites.get(key);
      if (pending !== undefined) {
        if (pending.remove === true) return emptyState;
        if (typeof pending.value === 'string') {
          try {
            const parsed = JSON.parse(pending.value);
            if (parsed !== null && typeof parsed === 'object') return parsed;
          } catch {
            return readStore();
          }
        }
      }
      return readStore();
    }

    function recordAudit(kind, text, sessionId) {
      if (isPrivateSession(sessionId)) return;
      if (typeof text !== 'string' || text === '') return;
      const entries = storeStateForWrite(AUDIT_KEY, readAudit, []);
      entries.push({ at: Date.now(), kind, hash: contentHash(text), len: text.length, sid: contentHash(sessionId) });
      scheduleWrite(AUDIT_KEY, JSON.stringify(entries.slice(-AUDIT_LIMIT)));
    }

    function avoidPromptsFor(sessionId) {
      const clicked = readClickedMap();
      const seen = new Set();
      const clickedFirst = [];
      const rest = [];
      for (const entry of capturesFor(sessionId).values()) {
        const isClicked = clicked[entry.clickedId] === true;
        for (const followup of entry.followups) {
          if (typeof followup.prompt !== 'string') continue;
          const prompt = followup.prompt.trim();
          if (prompt === '' || seen.has(prompt)) continue;
          seen.add(prompt);
          if (isClicked) clickedFirst.push(prompt);
          else rest.push(prompt);
        }
      }
      return [...clickedFirst, ...rest].slice(0, 20).map((item) => item.slice(0, 200));
    }

    function readFavorites() {
      const parsed = readJson(FAVORITES_KEY, null);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }

    function readFavoritesOrder() {
      const parsed = readJson(FAVORITES_ORDER_KEY, null);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((id) => typeof id === 'string' && id !== '');
    }

    function writeFavoritesOrder(hashes) {
      scheduleWrite(FAVORITES_ORDER_KEY, JSON.stringify(hashes));
    }

    function orderedFavoriteEntries(store, order) {
      const entries = Object.entries(store).filter((pair) => {
        const value = pair[1];
        return value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.prompt === 'string' && value.prompt !== '';
      });
      const byId = new Map(entries);
      const ordered = [];
      if (Array.isArray(order)) {
        for (const id of order) {
          if (byId.has(id)) {
            ordered.push([id, byId.get(id)]);
            byId.delete(id);
          }
        }
      }
      const remaining = [...byId.entries()];
      remaining.sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0));
      return ordered.concat(remaining);
    }

    function buildFavoritesMarkdown(store, order) {
      const entries = orderedFavoriteEntries(store, order);
      let markdown = '# Favourite suggestions';
      for (let index = 0; index < entries.length; index += 1) {
        const value = entries[index][1];
        const heading = typeof value.label === 'string' && value.label !== '' ? '## ' + value.label : '<!-- Suggestion ' + (index + 1) + ' -->';
        const lines = value.prompt.split('\n');
        const body = lines.some((line) => line.startsWith('```'))
          ? lines.map((line) => '    ' + line).join('\n')
          : '```\n' + value.prompt + '\n```';
        markdown += '\n\n' + heading + '\n\n' + body;
      }
      return markdown + '\n';
    }

    function buildFavoritesJson(store, order) {
      return JSON.stringify({ version: 1, favorites: store, order }, null, 2);
    }

    function readDiscarded() {
      const parsed = readJson(DISCARDED_KEY, null);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }

    let metricsCache = null;

    function readMetrics() {
      if (metricsCache !== null) return metricsCache;
      const parsed = readJson(METRICS_KEY, null);
      const metrics = { generation: [], persistence: [], rendering: [] };
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const stage of Object.keys(metrics)) {
          const samples = parsed[stage];
          metrics[stage] = Array.isArray(samples) ? samples.filter((value) => typeof value === 'number') : [];
        }
      }
      metricsCache = metrics;
      return metricsCache;
    }

    function recordMetric(stage, ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return;
      const metrics = readMetrics();
      const samples = metrics[stage];
      if (!Array.isArray(samples)) return;
      samples.push(Math.round(ms));
      while (samples.length > METRIC_SAMPLES) samples.shift();
      scheduleWrite(METRICS_KEY, JSON.stringify(metrics));
    }

    function turnIdOf(value) {
      if (typeof value === 'string' && value !== '') return value;
      if (typeof value === 'number') return String(value);
      if (value !== null && typeof value === 'object' && typeof value.turn === 'number') return String(value.turn);
      return undefined;
    }

    function formatElapsed(ms) {
      const total = Math.max(0, Math.floor(Number(ms) / 1000));
      const minutes = Math.floor(total / 60);
      const seconds = total % 60;
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function originOf(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
      const model = typeof value.model === 'string' && value.model !== '' ? value.model : undefined;
      const source = typeof value.source === 'string' && value.source !== '' ? value.source : undefined;
      const lang = typeof value.lang === 'string' && value.lang !== '' ? value.lang : undefined;
      const at = typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : undefined;
      if (model === undefined && source === undefined && lang === undefined && at === undefined) return undefined;
      return { model, source, lang, at };
    }

    function contentHash(text) {
      let hash = 5381;
      for (let index = 0; index < text.length; index++) {
        hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
      }
      return (hash >>> 0).toString(36);
    }

    const INJECTION_MARKERS = [
      'ignore previous',
      'ignore all previous',
      'ignore the above',
      'disregard previous',
      'disregard the above',
      'disregard all',
      'forget all previous',
      'forget the above',
      'you are now a',
      'act as the system',
      'system:',
      '<system>',
      '</system>',
      'developer message',
      'override your instructions',
      'new instructions:'
    ];
    const SECRET_PATTERNS = [
      /\bsk-[a-z0-9_-]{20,}/i,
      /\bgh[pousr]_[a-z0-9]{20,}/i,
      /\bgithub_pat_[a-z0-9_]{20,}/i,
      /\bglpat-[a-z0-9_-]{20,}/i,
      /\bAKIA[0-9A-Z]{16}\b/,
      /\bxox[baprs]-[a-z0-9-]{10,}/i,
      /\bBearer\s+[a-z0-9._~+/=-]{20,}/i,
      /\b(?:password|passwd|pwd)\s*[:=]\s*\S{8,}/i,
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/
    ];

    function cardWarnings(prompt) {
      if (typeof prompt !== 'string' || prompt === '') return [];
      const text = prompt.toLowerCase();
      const warnings = [];
      if (INJECTION_MARKERS.some((marker) => text.includes(marker))) warnings.push('injection');
      if (SECRET_PATTERNS.some((pattern) => pattern.test(prompt))) warnings.push('secrets');
      return warnings;
    }

    function validateFollowups(list) {
      if (!Array.isArray(list)) return null;
      const cap = Math.min(CHARS_MAX, Math.max(CHARS_MIN, Number(pluginSettings.maxSuggestionChars) || CHARS_DEFAULT));
      const followups = [];
      for (const item of list) {
        if (item === null || typeof item !== 'object') continue;
        if (typeof item.prompt !== 'string' || item.prompt.trim() === '') continue;
        followups.push({
          prompt: item.prompt.slice(0, cap),
          label: typeof item.label === 'string' && item.label.trim() !== '' ? item.label : null
        });
        if (followups.length === MAX_FOLLOWUPS) break;
      }
      return followups.length === 0 ? null : followups;
    }

    function followupsFromText(text) {
      if (typeof text !== 'string' || text === '') return null;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        return null;
      }
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch (error) {
          return null;
        }
      }
      if (Array.isArray(parsed)) return validateFollowups(parsed);
      if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.followups)) return null;
      return validateFollowups(parsed.followups);
    }

    function followupsFromContent(content) {
      if (!Array.isArray(content)) return null;
      let best = null;
      for (const entry of content) {
        const parts = Array.isArray(entry?.content) ? entry.content : [entry];
        for (const part of parts) {
          if (typeof part?.text !== 'string') continue;
          const followups = followupsFromText(part.text);
          if (followups !== null) best = followups;
        }
      }
      return best;
    }

    function displayLabel(followup) {
      if (followup.label !== null) return followup.label;
      const prompt = followup.prompt.trim();
      return prompt.length > PROMPT_TRUNCATE ? `${prompt.slice(0, PROMPT_TRUNCATE)}…` : prompt;
    }

    function errorMessage(error) {
      return error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message !== ''
        ? error.message
        : String(error);
    }

    function describeError(error) {
      if (error === null || typeof error !== 'object') return String(error);
      const status = error.status !== undefined ? ' status=' + String(error.status) : '';
      const code = typeof error.code === 'string' ? ' code=' + error.code : '';
      return String(error.name ?? 'Error') + status + code;
    }

    function urlOf(raw) {
      const text = String(raw ?? '');
      const query = text.indexOf('?');
      return query === -1 ? text : text.slice(0, query);
    }

    async function copyText(text) {
      try {
        const clipboard = typeof navigator === 'undefined' || navigator === null ? undefined : navigator.clipboard;
        if (clipboard !== undefined && clipboard !== null && typeof clipboard.writeText === 'function') {
          await clipboard.writeText(text);
          return true;
        }
      } catch (error) {
        console.warn('dsh-nextsteps: the clipboard refused the text:', error);
      }
      if (typeof document === 'undefined' || document === null || typeof document.execCommand !== 'function') return false;
      const area = document.createElement('textarea');
      if (area === null || area === undefined) return false;
      try {
        area.value = text;
        if (area.style !== undefined && area.style !== null) {
          area.style.position = 'fixed';
          area.style.opacity = '0';
        }
        if (typeof document.body?.appendChild === 'function') document.body.appendChild(area);
        if (typeof area.select === 'function') area.select();
        return document.execCommand('copy') === true;
      } catch (error) {
        console.warn('dsh-nextsteps: the copy fallback failed:', error);
        return false;
      } finally {
        if (typeof area.remove === 'function') area.remove();
      }
    }

    function resolveSend(ctx, sessionId) {
      const sessions = ctx.get('sessions');
      const conversation = ctx.get('conversation');
      if (sessions === undefined || sessions === null || conversation === undefined || conversation === null) {
        throw new Error('session services are not available yet');
      }
      const binding = sessions.binding(sessionId);
      if (binding === undefined) throw new Error(`unknown session "${sessionId}"`);

      const controller = typeof conversation.binding === 'function' ? conversation.binding(binding) : undefined;
      if (controller !== undefined && controller !== null && typeof controller.send === 'function') {
        return (text) => controller.send(text);
      }

      const input = typeof conversation.input === 'object' && conversation.input !== null ? conversation.input : undefined;
      const shell = input !== undefined && typeof input.shell === 'function' ? input.shell(sessionId) : undefined;
      const actions = shell !== undefined && shell !== null && shell.actions !== undefined && shell.actions !== null ? shell.actions : undefined;
      if (shell === undefined || actions === undefined || typeof actions.setDraft !== 'function' || typeof actions.submit !== 'function') {
        throw new Error('the conversation service exposes no send path');
      }
      return (text) => new Promise((resolve, reject) => {
        actions.setDraft(text);
        let tries = 0;
        const settle = () => {
          let draft;
          try {
            draft = shell.state.getSnapshot().draft;
          } catch (error) {
            draft = undefined;
          }
          if (draft === text || tries >= 12) {
            try {
              actions.submit();
            } catch (error) {
              console.warn('dsh-nextsteps: composer submit failed:', describeError(error));
              reject(error);
              return;
            }
            resolve(undefined);
            return;
          }
          tries += 1;
          window.setTimeout(settle, 25);
        };
        window.setTimeout(settle, 0);
      });
    }

    function FollowupsCard({ entries, sessionId, ctx, t, header, generatingLabel, footer, deferred, rootRef, retry, orderKey, afterSeq }) {
      const [sentLocally, setSentLocally] = React.useState(() => new Set());
      const [failure, setFailure] = React.useState(null);
      const [notice, setNotice] = React.useState('');
      const [itemState, setItemState] = React.useState(() => ({}));
      const [orderState, setOrderState] = React.useState(() => ({}));
      const [localStores, setLocalStores] = React.useState(() => ({ favorites: readFavorites(), discarded: readDiscarded() }));
      const [draggingId, setDraggingId] = React.useState(null);
      const dragRef = React.useRef(null);
      const busyRef = React.useRef(null);
      const sendTimersRef = React.useRef(new Map());
      const clicked = readClickedMap();

      React.useEffect(() => () => {
        for (const timerId of sendTimersRef.current.values()) window.clearTimeout(timerId);
        sendTimersRef.current.clear();
        for (const [regenKey, inFlight] of regenState) {
          if (regenKey.startsWith(sessionId + '|')) {
            inFlight.controller.abort();
            regenState.delete(regenKey);
          }
        }
      }, []);

      const clearSendTimers = (itemId) => {
        const timerId = sendTimersRef.current.get(itemId);
        if (timerId !== undefined) {
          window.clearTimeout(timerId);
          sendTimersRef.current.delete(itemId);
        }
      };
      const favorites = localStores.favorites;
      const discarded = localStores.discarded;
      const items = Array.isArray(entries) ? entries : [];
      const secretsWarnedRef = React.useRef(false);

      React.useEffect(() => {
        if (secretsWarnedRef.current === true) return;
        const hasSecrets = items.some((entry) => (Array.isArray(entry?.followups) ? entry.followups : []).some((followup) => typeof followup?.prompt === 'string' && cardWarnings(followup.prompt).includes('secrets')));
        if (hasSecrets !== true) return;
        secretsWarnedRef.current = true;
        setNotice(t('srSecretsWarning'));
      });

      React.useEffect(() => () => {
        if (dragRef.current !== null) {
          dragRef.current.detach();
          dragRef.current = null;
        }
      }, []);

      const startDrag = (event, itemId) => {
        if (dragRef.current !== null) return;
        const pointerId = event.pointerId;
        const startX = event.clientX;
        const startY = event.clientY;
        const drag = { pointerId, active: false, targetId: undefined, target: null, detach: null };
        const onMove = (moveEvent) => {
          if (moveEvent.pointerId !== drag.pointerId || dragRef.current !== drag) return;
          if (drag.active === false) {
            const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
            if (distance < DRAG_THRESHOLD_PX) return;
            drag.active = true;
            setDraggingId(itemId);
          }
          const hit = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY) : [];
          let nextTarget;
          for (const element of hit) {
            const id = element?.dataset?.itemId;
            if (typeof id === 'string' && id !== '' && id !== itemId) {
              nextTarget = [id, element];
              break;
            }
          }
          if (nextTarget !== undefined) {
            drag.targetId = nextTarget[0];
            drag.target = nextTarget[1];
          }
        };
        const settle = (endEvent, commit) => {
          if (endEvent.pointerId !== drag.pointerId) return;
          drag.detach();
          if (dragRef.current === drag) dragRef.current = null;
          setDraggingId(null);
          if (commit === true && drag.active === true && typeof drag.targetId === 'string') {
            const rect = drag.target?.getBoundingClientRect?.();
            const before = rect !== undefined ? endEvent.clientY < (rect.top + rect.bottom) / 2 : false;
            moveItem(itemId, drag.targetId, before);
          }
        };
        const onUp = (upEvent) => settle(upEvent, true);
        const onCancel = (cancelEvent) => settle(cancelEvent, false);
        drag.detach = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onCancel);
        };
        dragRef.current = drag;
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onCancel);
      };

      const updateItem = (itemId, patch) => {
        setItemState((previous) => ({ ...previous, [itemId]: { ...(previous[itemId] ?? {}), ...patch } }));
      };

      const refreshLocalStores = (favoritesNext, discardedNext) => {
        setLocalStores((previous) => ({
          favorites: favoritesNext ?? previous.favorites,
          discarded: discardedNext ?? previous.discarded
        }));
      };

      const send = (text, itemId, announcement) => {
        if (busyRef.current !== null) return;
        busyRef.current = itemId;
        let sendFollowup;
        try {
          sendFollowup = resolveSend(ctx, sessionId);
        } catch (error) {
          console.warn('dsh-nextsteps: send unavailable:', error);
          setFailure(t('sendFailed') + errorMessage(error));
          busyRef.current = null;
          return;
        }
        Promise.resolve()
          .then(() => sendFollowup(text))
          .then(() => {
            if (isPrivateSession(sessionId)) privateClicked.add(itemId);
            else markClicked(itemId);
            recordAudit('sent', text, sessionId);
            setSentLocally((previous) => new Set(previous).add(itemId));
            setFailure(null);
            setNotice(announcement);
          })
          .catch((error) => {
            console.warn('dsh-nextsteps: send failed:', describeError(error));
            setFailure(t('sendFailed') + errorMessage(error));
          })
          .finally(() => {
            busyRef.current = null;
          });
      };

      const copy = async (text, itemId) => {
        const copied = await copyText(text);
        if (!copied) {
          setNotice(t('copyFailed'));
          return;
        }
        setNotice(t('srCopied'));
        updateItem(itemId, { copied: true });
        window.setTimeout(() => updateItem(itemId, { copied: false }), 2000);
      };

      const toggleFavorite = (favId, prompt, label) => {
        const store = readFavorites();
        if (store[favId] !== undefined) delete store[favId];
        else store[favId] = { prompt, label, at: Date.now() };
        if (isPrivateSession(sessionId)) {
          refreshLocalStores(store, undefined);
          setNotice(t('srFavorited'));
          return;
        }
        scheduleWrite(FAVORITES_KEY, JSON.stringify(store));
        refreshLocalStores(store, undefined);
        setNotice(t('srFavorited'));
      };

      const discard = (captureKey, prompt, label, turn) => {
        const store = storeStateForWrite(DISCARDED_KEY, readDiscarded, {});
        store[captureKey] = { prompt, label, at: Date.now(), sessionId, turn };
        if (isPrivateSession(sessionId)) {
          refreshLocalStores(undefined, store);
          setNotice(t('srDiscarded'));
          for (const listener of discardListeners) listener(sessionId);
          return;
        }
        scheduleWrite(DISCARDED_KEY, JSON.stringify(store));
        refreshLocalStores(undefined, store);
        setNotice(t('srDiscarded'));
        for (const listener of discardListeners) listener(sessionId);
      };

      const regenerate = (itemId, prompt, label, entry) => {
        const turn = entry?.turn;
        if (turn === undefined || afterSeq === undefined) return;
        const regenKey = sessionId + '|' + turn;
        if (regenState.has(regenKey)) return;
        const controller = new AbortController();
        regenState.set(regenKey, { controller });
        updateItem(itemId, { regenerating: true });
        setNotice(t('regenerating'));
        discard(itemId, prompt, label, turn);
        (async () => {
          try {
            const seq = generationAfterSeq.get(generationKey(sessionId, turn)) ?? afterSeq;
            if (seq === undefined) return;
            const override = sessionOverrideOf(sessionId);
            const response = await fetch(GENERATE_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                sessionId,
                afterSeq: seq,
                maxFollowups: 1,
                ...(typeof override?.lang === 'string' && override.lang !== '' ? { lang: override.lang } : {}),
                ...(typeof override?.model === 'string' && override.model !== '' ? { model: override.model } : {}),
                avoid: [prompt, ...avoidPromptsFor(sessionId).filter((item) => item !== prompt)]
              }),
              signal: controller.signal
            });
            const data = await responseJson(response);
            if (!response.ok) {
              const detail = typeof data?.error === 'string' && data.error !== '' ? `: ${data.error}` : '';
              throw new Error(`the generator answered with HTTP ${response.status}${detail}`);
            }
            const followups = validateFollowups(Array.isArray(data?.followups) ? data.followups : null);
            if (followups === null) throw new Error('the generator answered without suggestions');
            rememberCapture(sessionId, 'manual-' + turn + '-' + manualCountFor(sessionId, turn), turn, followups.slice(0, 1));
            setFailure(null);
            setNotice(t('srRegenerated'));
          } catch (error) {
            if (!isAbortError(error)) setFailure(t('generationFailed') + errorMessage(error));
          } finally {
            if (regenState.get(regenKey)?.controller === controller) regenState.delete(regenKey);
            updateItem(itemId, { regenerating: false });
          }
        })();
      };

      const openNewChat = (prompt) => {
        let workspace;
        try { workspace = typeof ctx?.get === 'function' ? ctx.get('uiWorkspace') : undefined; } catch { workspace = undefined; }
        if (workspace === undefined || workspace === null || typeof workspace.startSession !== 'function') {
          console.warn('dsh-nextsteps: the uiWorkspace service is unavailable for the new-conversation action');
          setNotice(t('newChatUnavailable'));
          return;
        }
        try {
          workspace.startSession(undefined, { prompt, whenDraftExists: 'replace' });
        } catch (error) {
          console.warn('dsh-nextsteps: new conversation failed:', describeError(error));
          setNotice(t('newChatUnavailable'));
        }
      };

      const requestSend = (itemId, text, announcement) => {
        const state = itemState[itemId] ?? {};
        if (pluginSettings.confirmBeforeSend !== true) {
          send(text, itemId, announcement);
          return;
        }
        if (state.armed === true) {
          clearSendTimers(itemId);
          updateItem(itemId, { armed: false, armedText: undefined, armedAnnouncement: undefined });
          send(state.armedText ?? text, itemId, state.armedAnnouncement ?? announcement);
          return;
        }
        updateItem(itemId, { armed: true, armedText: text, armedAnnouncement: announcement });
        setNotice(t('srSendConfirm'));
        const timerId = window.setTimeout(() => {
          sendTimersRef.current.delete(itemId);
          updateItem(itemId, { armed: false, armedText: undefined, armedAnnouncement: undefined });
        }, CONFIRM_RESET_MS);
        sendTimersRef.current.set(itemId, timerId);
      };

      const requestNewChat = (itemId, prompt) => {
        const state = itemState[itemId] ?? {};
        if (pluginSettings.confirmBeforeSend !== true) {
          openNewChat(prompt);
          return;
        }
        if (state.chatArmed === true) {
          clearSendTimers(itemId);
          updateItem(itemId, { chatArmed: false });
          openNewChat(prompt);
          return;
        }
        updateItem(itemId, { chatArmed: true });
        setNotice(t('srSendConfirm'));
        const timerId = window.setTimeout(() => {
          sendTimersRef.current.delete(itemId);
          updateItem(itemId, { chatArmed: false });
        }, CONFIRM_RESET_MS);
        sendTimersRef.current.set(itemId, timerId);
      };

      const insertDraft = (text) => {
        let shell;
        try {
          const sessions = ctx.get('sessions');
          const conversation = ctx.get('conversation');
          if (sessions === undefined || sessions === null || conversation === undefined || conversation === null) {
            throw new Error('session services are not available yet');
          }
          const input = typeof conversation.input === 'object' && conversation.input !== null ? conversation.input : undefined;
          shell = input !== undefined && typeof input.shell === 'function' ? input.shell(sessionId) : undefined;
        } catch (error) {
          console.warn('dsh-nextsteps: the composer draft is unavailable:', error);
          setNotice(t('insertDraftUnavailable'));
          return;
        }
        const actions = shell !== undefined && shell !== null && shell.actions !== undefined && shell.actions !== null ? shell.actions : undefined;
        if (actions === undefined || typeof actions.setDraft !== 'function') {
          console.warn('dsh-nextsteps: the composer exposes no draft action for this session');
          setNotice(t('insertDraftUnavailable'));
          return;
        }
        try {
          actions.setDraft(text);
        } catch (error) {
          console.warn('dsh-nextsteps: placing the draft in the composer failed:', error);
          setNotice(t('insertDraftUnavailable'));
          return;
        }
        setNotice(t('srInserted'));
      };

      const sessionDiscards = Object.entries(discarded)
        .filter(([, value]) => value !== null && typeof value === 'object' && value.sessionId === sessionId);
      sessionDiscards.sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0));
      const recentDiscard = sessionDiscards.length === 0 ? undefined : sessionDiscards[0];

      const undoDiscard = (captureKey) => {
        const store = storeStateForWrite(DISCARDED_KEY, readDiscarded, {});
        if (store[captureKey] === undefined) return;
        delete store[captureKey];
        if (!isPrivateSession(sessionId)) scheduleWrite(DISCARDED_KEY, JSON.stringify(store));
        refreshLocalStores(undefined, store);
        setNotice(t('srRestored'));
        for (const listener of discardListeners) listener(sessionId);
      };

      const onItemKey = (event, itemId, prompt, label, entry) => {
        if (event === null || typeof event !== 'object') return;
        const key = typeof event.key === 'string' ? event.key : '';
        if (key === '') return;
        const target = event.target;
        const tag = target !== null && typeof target === 'object' && typeof target.tagName === 'string' ? target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (event.ctrlKey === true || event.metaKey === true || event.altKey === true || event.shiftKey === true) return;
        if (event.defaultPrevented === true) return;
        const stop = () => {
          if (typeof event.preventDefault === 'function') event.preventDefault();
        };
        if (key === 'c' || key === 'C') {
          stop();
          copy(prompt, itemId);
          return;
        }
        if (key === 'f' || key === 'F') {
          stop();
          toggleFavorite(contentHash(prompt), prompt, label);
          return;
        }
        if (key === 'e' || key === 'E') {
          stop();
          updateItem(itemId, { editing: true, draft: prompt });
          return;
        }
        if (key === 'i' || key === 'I') {
          stop();
          insertDraft(prompt);
          return;
        }
        if (key === 'd' || key === 'D') {
          stop();
          discard(itemId, prompt, label, entry.turn);
          return;
        }
        if (key === 'Escape') {
          const state = itemState[itemId] ?? {};
          if (state.editing === true) {
            stop();
            updateItem(itemId, { editing: false, draft: '' });
            return;
          }
          if (state.expanded === true) {
            stop();
            updateItem(itemId, { expanded: false });
          }
        }
      };

      const naturalIds = [];
      for (const entry of items) {
        const followups = Array.isArray(entry?.followups) ? entry.followups : [];
        for (const [index, followup] of followups.entries()) {
          const itemId = `${entry.clickedId}:${index}`;
          if (discarded[itemId] !== undefined) continue;
          naturalIds.push(itemId);
        }
      }
      const orderedIds = () => {
        if (orderKey === undefined) return naturalIds;
        const local = orderState[orderKey];
        const stored = Array.isArray(local) && local.length > 0 ? local : readCardOrder()[orderKey];
        if (!Array.isArray(stored) || stored.length === 0) return naturalIds;
        return stored.filter((id) => naturalIds.includes(id)).concat(naturalIds.filter((id) => !stored.includes(id)));
      };
      const commitOrder = (ids) => {
        if (orderKey === undefined) return;
        setOrderState((previous) => ({ ...previous, [orderKey]: ids }));
        if (!isPrivateSession(sessionId)) writeCardOrder(orderKey, ids);
        setNotice(t('srReordered'));
      };
      const moveItem = (draggedId, targetId, before = false) => {
        if (orderKey === undefined || draggedId === targetId) return;
        const ids = [...orderedIds()];
        const from = ids.indexOf(draggedId);
        const to = ids.indexOf(targetId);
        if (from === -1 || to === -1) return;
        const insertAt = before ? (from < to ? to - 1 : to) : (from < to ? to : to + 1);
        ids.splice(insertAt, 0, ids.splice(from, 1)[0]);
        commitOrder(ids);
      };
      const moveItemBy = (itemId, delta) => {
        if (orderKey === undefined) return;
        const ids = [...orderedIds()];
        const from = ids.indexOf(itemId);
        const to = from + delta;
        if (from === -1 || to < 0 || to >= ids.length) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        commitOrder(ids);
      };

      const rows = [];
      const rowSpecs = new Map();
      const buildStarted = Date.now();
      for (const entry of items) {
        const followups = Array.isArray(entry?.followups) ? entry.followups : [];
        const origin = originOf(entry?.origin);
        for (const [index, followup] of followups.entries()) {
          const itemId = `${entry.clickedId}:${index}`;
          if (discarded[itemId] !== undefined) continue;
          const label = displayLabel(followup);
          const prompt = followup.prompt;
          const state = itemState[itemId] ?? {};
          const sent = sentLocally.has(itemId) || clicked[itemId] === true || privateClicked.has(itemId);
          const canExpand = prompt !== label;
          const favId = contentHash(prompt);
          const fav = favorites[favId] !== undefined;
          const editorValue = state.draft ?? prompt;
          const charRemaining = Math.min(CHARS_MAX, Math.max(CHARS_MIN, Number(pluginSettings.maxSuggestionChars) || CHARS_DEFAULT)) - editorValue.length;
          rowSpecs.set(itemId, h('div', {
            key: itemId,
            className: 'dsh-sf-item',
            role: 'group',
            'aria-label': prompt,
            onKeyDown: (event) => onItemKey(event, itemId, prompt, label, entry)
          },
            h('div', {
              className: 'dsh-sf-cardline' + (draggingId === itemId ? ' is-dragging' : ''),
              'data-item-id': itemId
            },
              h('span', {
                className: 'dsh-sf-grip',
                title: t('dragToReorder'),
                'aria-hidden': true,
                onPointerDown: (event) => startDrag(event, itemId)
              }, '⠿'),
              h('button', {
                type: 'button',
                className: 'dsh-sf-card' + (sent ? ' is-sent' : ''),
                disabled: sent,
                title: prompt,
                'aria-label': prompt,
                onClick: () => {
                  if (sent) return;
                  requestSend(itemId, prompt, t('srFollowupSent'));
                }
              },
                h('span', { className: 'dsh-sf-icon', 'aria-hidden': true }, sent ? '✓' : '→'),
                h('span', { className: 'dsh-sf-label' }, label),
                sent ? h('span', { className: 'dsh-sf-sr' }, t('srFollowupSent')) : null),
              ...cardWarnings(prompt).map((kind) => h('span', {
                key: kind,
                className: 'dsh-sf-warn',
                'aria-label': kind === 'secrets' ? t('warnSecrets') : t('warnInjection'),
                title: kind === 'secrets' ? t('warnSecrets') : t('warnInjection')
              }, '⚠'))),
            h('span', { className: 'dsh-sf-item-actions' },
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': state.copied === true ? t('copied') : t('actionCopy'),
                title: state.copied === true ? t('copied') : `${t('actionCopy')} (C)`,
                'aria-keyshortcuts': 'c',
                onClick: () => copy(prompt, itemId)
              }, state.copied === true ? t('copied') : '⧉'),
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': t('actionFavorite'),
                title: `${t('actionFavorite')} (F)`,
                'aria-keyshortcuts': 'f',
                onClick: () => toggleFavorite(favId, prompt, label)
              }, fav ? '★' : '☆'),
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': t('actionEdit'),
                title: `${t('actionEdit')} (E)`,
                'aria-keyshortcuts': 'e',
                onClick: () => updateItem(itemId, { editing: true, draft: prompt })
              }, '✎'),
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': t('actionInsertDraft'),
                title: `${t('actionInsertDraft')} (I)`,
                'aria-keyshortcuts': 'i',
                onClick: () => insertDraft(prompt)
              }, '⤓'),
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': t('actionDiscard'),
                title: `${t('actionDiscard')} (D)`,
                'aria-keyshortcuts': 'd',
                onClick: () => discard(itemId, prompt, label, entry.turn)
              }, '✕'),
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': t('actionRegenerate'),
                title: t('actionRegenerate'),
                disabled: regenState.has(sessionId + '|' + (entry.turn ?? '')) || state.regenerating === true,
                onClick: () => regenerate(itemId, prompt, label, entry)
              }, '↻'),
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': t('actionMoveEarlier'),
                title: t('actionMoveEarlier'),
                onClick: () => moveItemBy(itemId, -1)
              }, '↑'),
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': t('actionMoveLater'),
                title: t('actionMoveLater'),
                onClick: () => moveItemBy(itemId, 1)
              }, '↓'),
              canExpand ? h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': state.expanded === true ? t('actionCollapse') : t('actionExpand'),
                onClick: () => updateItem(itemId, { expanded: state.expanded !== true })
              }, state.expanded === true ? '⌃' : '…') : null,
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': t('actionNewChat'),
                title: t('actionNewChat'),
                onClick: () => requestNewChat(itemId, prompt)
              }, '↗')),
            state.armed === true || state.chatArmed === true ? h('span', { className: 'dsh-sf-confirm' },
              h('span', { className: 'dsh-sf-prompt' }, state.chatArmed === true ? t('newChatConfirm') : t('sendConfirm')),
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                onClick: () => {
                  if (state.chatArmed === true) {
                    clearSendTimers(itemId);
                    updateItem(itemId, { chatArmed: false });
                    openNewChat(prompt);
                    return;
                  }
                  requestSend(itemId, prompt, t('srFollowupSent'));
                }
              }, t('sendConfirmYes')),
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                onClick: () => {
                  clearSendTimers(itemId);
                  updateItem(itemId, { armed: false, armedText: undefined, armedAnnouncement: undefined, chatArmed: false });
                }
              }, t('editCancel'))) : null,
            state.expanded === true ? h('div', { className: 'dsh-sf-prompt' }, prompt) : null,
            state.editing === true ? h('div', { className: 'dsh-sf-editor' },
              h('textarea', {
                className: 'dsh-sf-textarea',
                'aria-label': t('editPrompt'),
                value: state.draft ?? prompt,
                onChange: (event) => updateItem(itemId, { draft: event.target.value })
              }),
              h('span', {
                className: 'dsh-sf-charcount' + (charRemaining < 0 ? ' dsh-sf-charcount-over' : '')
              }, charRemaining >= 0
                ? t('charsRemaining').replace('{n}', String(charRemaining))
                : t('charsOver').replace('{n}', String(Math.abs(charRemaining)))),
              h('span', { className: 'dsh-sf-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsh-sf-action',
                onClick: () => {
                  const draft = (state.draft ?? prompt).trim();
                  if (draft === '') return;
                  const sendsNow = pluginSettings.confirmBeforeSend !== true || state.armed === true;
                  requestSend(itemId, draft, t('srEdited'));
                  if (sendsNow) updateItem(itemId, { editing: false, draft: '' });
                }
                }, t('editConfirm')),
                h('button', {
                  type: 'button',
                  className: 'dsh-sf-action',
                  onClick: () => updateItem(itemId, { editing: false, draft: '' })
                }, t('editCancel')))) : null,
            h('span', { className: 'dsh-sf-hints' },
              `${t('actionCopy')} C · ${t('actionFavorite')} F · ${t('actionEdit')} E · ${t('actionInsertDraft')} I · ${t('actionDiscard')} D`),
            index === followups.length - 1 && origin?.model !== undefined && origin?.source !== undefined
              ? h('div', { className: 'dsh-sf-origin' }, t('originLabel').replace('{model}', origin.model).replace('{source}', origin.source) + (origin.lang ? ' · ' + origin.lang : ''))
              : null));
        }
      }
      for (const sortedId of orderedIds()) rows.push(rowSpecs.get(sortedId));

      recordMetric('rendering', Date.now() - buildStarted);

      return h('div', { className: 'dsh-sf-root', ref: rootRef },
        header ?? null,
        generatingLabel === '' ? null : h('div', { className: 'dsh-sf-generating' }, t('generatingElapsed').replace('{t}', generatingLabel)),
        deferred === true
          ? h('div', { className: 'dsh-sf-placeholder' }, '…')
          : h('div', { className: 'dsh-sf-row' }, rows),
        failure === null ? null : h('div', { className: 'dsh-sf-error' }, failure),
        h('div', { className: 'dsh-sf-notice', style: notice === '' ? { display: 'none' } : undefined }, notice),
        h('div', { className: 'dsh-sf-sr', role: 'status' }, notice),
        recentDiscard === undefined ? null : h('span', { className: 'dsh-sf-actions' },
          h('button', {
            type: 'button',
            className: 'dsh-sf-action',
            'aria-label': t('undoDiscard'),
            title: t('undoDiscard'),
            onClick: () => undoDiscard(recentDiscard[0])
          }, t('undoDiscard'))),
        footer ?? null,
        retry ?? null);
    }

    const generationState = new Map();
    const generationAfterSeq = new Map();
    const failedGenerations = new Map();
    const regenState = new Map();
    const validatedTurns = new Map();
    const warnedTurns = new Set();
    let settingsRevision = 0;
    const VALIDATED_TURNS_LIMIT = 200;
    const PROBE_TIMEOUT_MS = 5000;

    function generationKey(sessionId, turn) {
      return `${sessionId}|${turn}`;
    }

    function isAbortError(error) {
      return error !== null && typeof error === 'object' && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
    }

    function warnGeneration(key, error) {
      if (warnedTurns.has(key)) return;
      warnedTurns.add(key);
      if (warnedTurns.size > 200) warnedTurns.delete(warnedTurns.values().next().value);
      console.warn('dsh-nextsteps: generation failed:', describeError(error));
    }

    function cancelGeneration(sessionId, turn) {
      const key = generationKey(sessionId, turn);
      const state = generationState.get(key);
      if (state === undefined) return;
      state.cancelled = true;
      if (state.controller !== null && typeof state.controller.abort === 'function') state.controller.abort();
      generationState.delete(key);
    }

    function waitFor(ms) {
      return new Promise((resolve) => { window.setTimeout(resolve, ms); });
    }

    async function startGeneration(sessionId, turn, afterSeq) {
      const key = generationKey(sessionId, turn);
      if (generationState.has(key)) return;
      const state = { controller: null, attempts: 0, cancelled: false, startedAt: Date.now() };
      generationState.set(key, state);
      for (const listener of captureListeners) listener(sessionId);
      const revision = settingsRevision;
      const override = sessionOverrideOf(sessionId);
      const avoid = avoidPromptsFor(sessionId);
      const budget = Math.min(LATENCY_MAX_MS, Math.max(LATENCY_MIN_MS, Number(pluginSettings.latencyBudgetMs) || LATENCY_DEFAULT_MS));
      const deadline = budget + 5000;
      let failure = new Error('the generator did not answer');
      try {
        while (state.attempts < GENERATION_ATTEMPTS) {
          if (state.cancelled) return;
          state.attempts += 1;
          const controller = new AbortController();
          state.controller = controller;
          let expired = false;
          const expiry = window.setTimeout(() => { expired = true; controller.abort(); }, deadline);
          let retryable = false;
          try {
            const started = Date.now();
            const response = await fetch(GENERATE_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                sessionId,
                afterSeq,
                ...(override !== undefined && typeof override.lang === 'string' && override.lang !== '' ? { lang: override.lang } : {}),
                ...(Number.isInteger(override?.maxFollowups) ? { maxFollowups: override.maxFollowups } : {}),
                ...(override !== undefined && typeof override.model === 'string' && override.model !== '' ? { model: override.model } : {}),
                ...(avoid.length > 0 ? { avoid } : {})
              }),
              signal: controller.signal
            });
            recordMetric('generation', Date.now() - started);
            if (state.cancelled) return;
            if (response.status === 409) {
              state.cancelled = true;
              return;
            }
            const data = await responseJson(response);
            if (state.cancelled) return;
            if (!response.ok) {
              const detail = typeof data?.error === 'string' && data.error !== '' ? `: ${data.error}` : '';
              failure = new Error(`the generator answered with HTTP ${response.status}${detail}`);
              retryable = response.status >= 500;
            } else {
              const followups = validateFollowups(Array.isArray(data?.followups) ? data.followups : null);
              if (followups === null) {
                failure = new Error('the generator answered without suggestions');
                retryable = true;
              } else {
                if (revision !== settingsRevision) return;
                failedGenerations.delete(key);
                const hasOrigin = (typeof data?.model === 'string' && data.model !== '') || (typeof data?.source === 'string' && data.source !== '');
                const origin = hasOrigin
                  ? {
                    model: typeof data?.model === 'string' && data.model !== '' ? data.model : undefined,
                    source: typeof data?.source === 'string' && data.source !== '' ? data.source : undefined,
                    lang: typeof override?.lang === 'string' && override.lang !== '' ? override.lang : undefined,
                    at: Date.now()
                  }
                  : undefined;
                rememberCapture(sessionId, 'generated-' + turn, turn, followups, origin);
                return;
              }
            }
          } catch (error) {
            if (state.cancelled) return;
            if (isAbortError(error) && !expired) return;
            failure = expired ? new Error('the generator did not answer in time') : error;
            retryable = true;
          } finally {
            window.clearTimeout(expiry);
          }
          if (state.cancelled) return;
          if (!retryable || state.attempts >= GENERATION_ATTEMPTS) break;
          await waitFor(RETRY_DELAY_MS);
        }
        if (state.cancelled) return;
        failedGenerations.set(key, String(failure?.message ?? failure));
        if (failedGenerations.size > 200) failedGenerations.delete(failedGenerations.keys().next().value);
        warnGeneration(key, failure);
      } finally {
        if (generationState.get(key) === state) generationState.delete(key);
        for (const listener of captureListeners) listener(sessionId);
      }
    }

    function createTail(ctx) {
      return function SuggestFollowupsTail(props) {
        const sessionId = typeof props.sessionId === 'string' ? props.sessionId : '';
        const turn = turnIdOf(props.turn);
        const afterSeq = props.turn !== null && typeof props.turn === 'object' && Number.isSafeInteger(props.turn.end?.seq)
          ? props.turn.end.seq
          : (Number.isSafeInteger(props.seq) ? props.seq : undefined);
        const t = typeof props.t === 'function' ? props.t : (key) => key;
        const [, refresh] = React.useReducer((count) => count + 1, 0);
        const [visible, setVisible] = React.useState(() => typeof IntersectionObserver !== 'function');
        const [manualOpen, setManualOpen] = React.useState(false);
        const [manualText, setManualText] = React.useState('');
        const [sessionOptionsOpen, setSessionOptionsOpen] = React.useState(false);
        const [generatingLabel, setGeneratingLabel] = React.useState('');
        const [gearNotice, setGearNotice] = React.useState(false);
        const [sessionModels, setSessionModels] = React.useState(() => modelCatalogCache);
        const [privateNotice, setPrivateNotice] = React.useState('');
        const rootRef = React.useRef(null);
        const host = hostModeFor(sessionId);
        const [overridesVersion, setOverridesVersion] = React.useState(0);

        React.useEffect(() => {
          let alive = true;
          loadModelCatalog(false).then((catalog) => { if (alive) setSessionModels(catalog); });
          return () => {
            alive = false;
          };
        }, []);

        React.useEffect(() => {
          captureListeners.add(refresh);
          return () => {
            captureListeners.delete(refresh);
          };
        }, []);

        React.useEffect(() => {
          const listener = () => refresh();
          discardListeners.add(listener);
          return () => {
            discardListeners.delete(listener);
          };
        }, []);

        React.useEffect(() => {
          const listener = () => setOverridesVersion((v) => v + 1);
          sessionOverrideListeners.add(listener);
          return () => {
            sessionOverrideListeners.delete(listener);
          };
        }, []);

        React.useEffect(() => {
          if (sessionId === '' || turn === undefined) return undefined;
          return () => {
            cancelGeneration(sessionId, turn);
          };
        }, [sessionId, turn]);

        let entries = turn !== undefined ? capturesForTurn(sessionId, turn) : [];
        if (entries.length === 0 && turn === undefined && !hostModeFor(sessionId)) {
          const newest = newestCapture(sessionId);
          if (newest !== null) entries = [newest];
        }
        if (entries.length === 0 && !hostModeFor(sessionId)) {
          const unclaimed = unclaimedCaptures(sessionId, turn);
          if (unclaimed !== null) entries = [unclaimed];
        }

        const key = turn === undefined ? '' : generationKey(sessionId, turn);
        const orderKey = turn === undefined ? undefined : sessionId + '|' + turn;
        const generating = key !== '' && generationState.has(key);
        const onDemand = pluginSettings.generationMode === 'on-demand';
        const failureMessage = key !== '' && turn !== undefined ? failedGenerations.get(key) : undefined;
        const [probeResults, setProbeResults] = React.useState(() => ({}));

        const cachedProbe = key === '' ? undefined : validatedTurns.get(key);
        const probeCompleted = onDemand === true && turn !== undefined && (
          probeResults[key] === true
          || (cachedProbe?.revision === settingsRevision && cachedProbe.completed === true)
        );
        const probeNeeded = onDemand === true && turn !== undefined && afterSeq !== undefined
          && entries.length === 0 && generating === false && failureMessage === undefined
          && probeResults[key] === undefined
          && !(cachedProbe?.revision === settingsRevision);

        React.useEffect(() => {
          if (probeNeeded !== true) return undefined;
          let cancelled = false;
          const body = JSON.stringify({ sessionId, afterSeq, validate: true });
          const run = async () => {
            let completed = false;
            try {
              const response = await fetch(GENERATE_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
              const data = await responseJson(response);
              completed = data?.completed === true;
            } catch {
              completed = false;
            }
            if (cancelled) return;
            validatedTurns.set(key, { revision: settingsRevision, probed: true, completed });
            if (validatedTurns.size > VALIDATED_TURNS_LIMIT) validatedTurns.delete(validatedTurns.keys().next().value);
            setProbeResults((previous) => ({ ...previous, [key]: completed }));
          };
          run();
          return () => {
            cancelled = true;
          };
        }, [key, probeNeeded, settingsRevision]);

        const retry = failureMessage !== undefined && entries.length === 0 && turn !== undefined ? h('div', { className: 'dsh-sf-retry' },
          h('span', { className: 'dsh-sf-error' }, t('generationFailed') + failureMessage),
          h('button', {
            type: 'button',
            className: 'dsh-sf-action',
            'aria-label': t('retryGeneration'),
            disabled: generating,
            onClick: () => {
              const seq = generationAfterSeq.get(key) ?? afterSeq;
              if (seq !== undefined) startGeneration(sessionId, turn, seq);
            }
          }, t('retryGeneration'))) : null;

        const sessionDiscards = Object.entries(readDiscarded())
          .filter(([, value]) => value !== null && typeof value === 'object' && value.sessionId === sessionId);
        sessionDiscards.sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0));
        const recentDiscard = sessionDiscards.length === 0 ? undefined : sessionDiscards[0];

        const renders = entries.length > 0 || retry !== null || recentDiscard !== undefined || probeCompleted === true;

        React.useEffect(() => {
          const supported = typeof IntersectionObserver === 'function';
          setVisible(!supported);
          if (!supported) return undefined;
          if (renders !== true) return undefined;
          const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
          }, { rootMargin: '200px' });
          const node = rootRef.current;
          if (node !== null && node !== undefined && typeof observer.observe === 'function') observer.observe(node);
          return () => {
            if (typeof observer.disconnect === 'function') observer.disconnect();
          };
        }, [sessionId, turn, renders]);

        React.useEffect(() => {
          if (sessionId === '' || turn === undefined) return undefined;
          generationAfterSeq.set(generationKey(sessionId, turn), afterSeq);
          if (!hostModeFor(sessionId)) return undefined;
          if (pluginSettings.generationMode === 'on-demand') return undefined;
          if (afterSeq === undefined) return undefined;
          if (capturesForTurn(sessionId, turn).length > 0) return undefined;
          startGeneration(sessionId, turn, afterSeq);
          return () => {
            cancelGeneration(sessionId, turn);
          };
        }, [sessionId, turn, afterSeq, host]);

        React.useEffect(() => {
          if (generating !== true || key === '') {
            setGeneratingLabel('');
            return undefined;
          }
          let alive = true;
          const tick = () => {
            if (alive === false) return;
            const startedAt = generationState.get(key)?.startedAt;
            if (typeof startedAt !== 'number') return;
            setGeneratingLabel(formatElapsed(Date.now() - startedAt));
            window.setTimeout(tick, 1000);
          };
          tick();
          return () => {
            alive = false;
            setGeneratingLabel('');
          };
        }, [generating, key]);

        if (entries.length === 0 && generating !== true && retry === null && recentDiscard === undefined && probeCompleted !== true) return null;

        const saveManual = () => {
          const text = manualText.trim();
          if (text === '' || turn === undefined) return;
          rememberCapture(sessionId, 'manual-' + turn + '-' + manualCountFor(sessionId, turn), turn, [{ prompt: text, label: null }]);
          setManualText('');
          setManualOpen(false);
        };

        const header = h('div', { className: 'dsh-sf-header-row' },
          pluginSettings.showHeader ? h('div', { className: 'dsh-sf-header' }, t('header')) : null,
          h('button', {
            type: 'button',
            className: 'dsh-sf-action',
            'aria-label': t('addSuggestion'),
            onClick: () => setManualOpen(true)
          }, t('addSuggestion')),
          manualOpen ? h('span', { className: 'dsh-sf-manual' },
            h('textarea', {
              className: 'dsh-sf-textarea',
              placeholder: t('manualPlaceholder'),
              'aria-label': t('manualPlaceholder'),
              value: manualText,
              onChange: (event) => setManualText(event.target.value)
            }),
            h('span', { className: 'dsh-sf-actions' },
              h('button', { type: 'button', className: 'dsh-sf-action', onClick: saveManual }, t('manualSave')),
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                onClick: () => {
                  setManualOpen(false);
                  setManualText('');
                }
              }, t('manualCancel')))) : null,
          h('button', {
            type: 'button',
            className: 'dsh-sf-action',
            'aria-label': t('sessionOptions'),
            onClick: () => setSessionOptionsOpen((open) => !open)
          }, t('sessionOptions')),
          sessionOptionsOpen ? h('span', { className: 'dsh-sf-manual' },
            h('select', {
              value: sessionOverrideOf(sessionId)?.lang ?? '',
              onChange: (event) => writeSessionOverride(sessionId, { lang: event.target.value }),
              'aria-label': t('setLanguage')
            },
              h('option', { value: '' }, t('sessionLangGlobal')),
              ...LANGUAGE_OPTIONS.map((option) => h('option', { key: option.value, value: option.value }, option.label))),
            h('input', {
              type: 'number',
              min: 1,
              max: 6,
              value: sessionOverrideOf(sessionId)?.maxFollowups ?? '',
              onChange: (event) => writeSessionOverride(sessionId, { maxFollowups: event.target.value === '' ? '' : Number(event.target.value) }),
              'aria-label': t('setMax')
            }),
            sessionModels !== undefined && (sessionModels.groups ?? []).length > 0 ? h('select', {
              value: sessionOverrideOf(sessionId)?.model ?? '',
              onChange: (event) => writeSessionOverride(sessionId, { model: event.target.value }),
              'aria-label': t('setModel')
            },
              h('option', { value: '' }, t('sessionLangGlobal')),
              ...sessionModels.groups.map((group) => h('optgroup', { key: group.id, label: group.name },
                group.models.map((entry) => h('option', { key: group.id + '/' + entry.id, value: group.id + '/' + entry.id }, entry.name === entry.id ? entry.name : entry.name + ' (' + entry.id + ')'))))) : null,
            h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 } },
              h('input', {
                type: 'checkbox',
                checked: isPrivateSession(sessionId),
                onChange: (event) => {
                  const checked = event.target.checked;
                  const residue = writePrivateSession(sessionId, checked) === true;
                  setPrivateNotice(!checked ? t('srPrivateOff') : residue ? t('privatePurgeFailed') : t('srPrivateOn'));
                  refresh();
                }
              }),
              t('sessionPrivate'),
              privateNotice === '' ? null : h('span', { className: 'dsh-sf-placeholder' }, privateNotice)),
            h('button', {
              type: 'button',
              className: 'dsh-sf-action',
              'aria-label': t('sessionReset'),
              onClick: () => {
                clearSessionOverride(sessionId);
                setSessionOptionsOpen(false);
              }
            }, t('sessionReset'))) : null,
          h('button', {
            type: 'button',
            className: 'dsh-sf-action',
            'aria-label': t('openSettings'),
            title: t('openSettings'),
            onClick: () => {
              try {
                const nav = ctx.get('pluginNavigation');
                if (nav === undefined || nav === null || typeof nav.openSettings !== 'function') throw new Error('plugin navigation is unavailable');
                nav.openSettings('dsh-nextsteps');
                setGearNotice(false);
              } catch (error) {
                console.warn('dsh-nextsteps: opening the settings failed:', error);
                setGearNotice(true);
              }
            }
          }, '⚙'),
          gearNotice === true ? h('span', { className: 'dsh-sf-placeholder' }, t('settingsUnavailable')) : null);

        const footer = onDemand ? h('span', { className: 'dsh-sf-actions' },
          h('button', {
            type: 'button',
            className: 'dsh-sf-action',
            onClick: () => {
              const seq = generationAfterSeq.get(key) ?? afterSeq;
              if (turn === undefined || seq === undefined) return;
              startGeneration(sessionId, turn, seq);
            }
          }, generating ? t('generating') : t('generateNow'))) : null;

        return h(FollowupsCard, {
          entries,
          sessionId,
          ctx,
          t,
          header,
          generatingLabel,
          footer,
          retry,
          orderKey,
          afterSeq,
          deferred: visible !== true,
          rootRef
        });
      };
    }

    function createCapture() {
      return function SuggestFollowupsCapture(props) {
        const sessionId = typeof props.sessionId === 'string' ? props.sessionId : '';
        if (sessionId !== '') {
          const block = props.block;
          const callId = typeof props.callId === 'string' && props.callId !== ''
            ? props.callId
            : typeof block?.callId === 'string' ? block.callId : '';
          const turn = turnIdOf(block?.turn);
          const followups = followupsFromText(block?.argsRaw)
            ?? followupsFromText(block?.call?.argsRaw)
            ?? followupsFromContent(block?.content);
          if (pluginSettings.generationMode === 'on-demand') return null;
          if (followups !== null) rememberCapture(sessionId, callId, turn, followups);
        }
        return null;
      };
    }

    const LANGUAGE_OPTIONS = [
      { value: "en", label: "English" },
      { value: "pt-BR", label: "Português (Brasil)" },
      { value: "zh-CN", label: "简体中文" },
      { value: "es", label: "Español" },
      { value: "fr", label: "Français" },
      { value: "de", label: "Deutsch" },
      { value: "it", label: "Italiano" },
      { value: "ja", label: "日本語" },
      { value: "ko", label: "한국어" },
      { value: "ru", label: "Русский" },
      { value: "ar", label: "العربية" },
      { value: "hi", label: "हिन्दी" },
      { value: "id", label: "Bahasa Indonesia" },
      { value: "tr", label: "Türkçe" },
      { value: "vi", label: "Tiếng Việt" }
    ];
    const MODELS_ROUTE = '/api/dsh-nextsteps.models';
    const GENERATE_ROUTE = '/api/dsh-nextsteps.generate';
    let modelCatalogCache = undefined;

    async function loadModelCatalog(force) {
      if (modelCatalogCache === undefined || force === true) {
        try {
          const response = await fetch(MODELS_ROUTE, { cache: 'no-store' });
          const data = await responseJson(response);
          if (data !== null && typeof data === 'object' && data.ok === true) modelCatalogCache = data;
        } catch (error) {
          console.warn('dsh-nextsteps: model catalog unavailable:', error);
        }
      }
      return modelCatalogCache;
    }
    const ICON_DATAURI = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20256%20256%22%20role%3D%22img%22%20aria-label%3D%22Nextsteps%20icon%22%3E%0A%20%20%3Crect%20width%3D%22256%22%20height%3D%22256%22%20rx%3D%2256%22%20fill%3D%22%230d0d10%22%2F%3E%0A%20%20%3Crect%20x%3D%2252%22%20y%3D%2264%22%20width%3D%22152%22%20height%3D%2244%22%20rx%3D%2210%22%20fill%3D%22%231f242b%22%20stroke%3D%22%234b5563%22%20stroke-width%3D%223%22%2F%3E%0A%20%20%3Crect%20x%3D%2252%22%20y%3D%22124%22%20width%3D%22152%22%20height%3D%2244%22%20rx%3D%2210%22%20fill%3D%22%231f242b%22%20stroke%3D%22%234b5563%22%20stroke-width%3D%223%22%2F%3E%0A%20%20%3Crect%20x%3D%2252%22%20y%3D%22184%22%20width%3D%22152%22%20height%3D%2244%22%20rx%3D%2210%22%20fill%3D%22%23e5484d%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M84%20206h72M136%20194l14%2012-14%2012%22%20stroke%3D%22%23ffffff%22%20stroke-width%3D%228%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20fill%3D%22none%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M76%2086h96M76%20146h96%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%227%22%20stroke-linecap%3D%22round%22%2F%3E%0A%3C%2Fsvg%3E%0A';
    const SETTINGS_ROUTE = '/api/dsh-nextsteps.settings';
    const MODEL_TEST_ROUTE = '/api/dsh-nextsteps.model-test';
    const DICTIONARIES = {
      en: {"header":"Suggested followups","srFollowupSent":"Followup sent","sendFailed":"Could not send: ","intro":"Suggested next-step prompts under every finished agent turn — one click sends the followup.","setLanguage":"Language","setLanguageTip":"Followups are generated in this language. Auto follows the conversation; an explicit language uses a separate call.","optAuto":"Auto (follow the conversation)","setModel":"Model","setModelTip":"The model that generates the suggestions. Auto uses the chat's model inside the turn; an explicit language or model uses a separate call.","optModelAuto":"Auto (same model as the chat)","modelUnavailable":"No model list available in this install","setMax":"Followups per turn","setMaxTip":"How many suggested prompts the model should produce (1-6).","setHeader":"Show header","setHeaderTip":"The small “Suggested followups” label above the cards.","setConfirmSend":"Confirm before sending","setConfirmSendTip":"The first click arms the send and the second confirms; it also applies to new conversation.","update":"Updates","current":"Current version","check":"Check for updates","checking":"Checking…","upToDate":"You are on the latest version","available":"Update available","open":"Open release page","none":"No releases published yet","updateNow":"Update now","installingMsg":"Installing {v}...","installedMsg":"Version {v} was installed. Restart the dsh to use it.","heldBackMsg":"Version {v} was installed instead of {asked} — pnpm holds back a release that is too recent.","localDev":"Local development copy — update with git pull.","error":"Update check failed","installError":"The update failed","unsupportedVersion":"That release is not a version this plugin can install","repo":"GitHub repository","issues":"Report an issue","setStyles":"Suggestion styles","setStylesTip":"The angles the suggestions should cover. The generator varies the prompts across the selected styles. At least one style stays selected.","styleNextAction":"Next action","styleExplore":"Explore","styleDeepDive":"Deep dive","setGenMode":"Generation","setGenModeTip":"Auto suggests the followups when the turn ends; on demand waits for your button.","optGenAuto":"Auto (when the turn ends)","optGenOnDemand":"On demand (button)","setBudget":"Latency budget","setBudgetTip":"How long the generator may run before the request is given up (5000-120000 ms).","setMaxChars":"Suggestion length","setMaxCharsTip":"The maximum number of characters of one suggestion (60-600).","metrics":"Performance","metricGeneration":"Generation","metricPersistence":"Persistence","metricRendering":"Rendering","metricAvg":"Average","metricMax":"Maximum","metricNoData":"No data yet","favorites":"Favourites","favoritesEmpty":"No favourite suggestion yet.","favoritesSearch":"Search favourites","favoriteCopy":"Copy","favoriteRemove":"Remove","favoriteEdit":"Edit favourite","favoriteDuplicate":"A favourite with this text already exists.","favoriteSelectAll":"Select all","favoriteCopySelected":"Copy selected ({n})","favoriteRemoveSelected":"Remove selected ({n})","favoriteRemoveConfirm":"Confirm removing {n}","discarded":"Discarded","discardedEmpty":"No discarded suggestion.","discardRestore":"Restore","actionCopy":"Copy","actionDiscard":"Discard","actionFavorite":"Favourite","actionEdit":"Edit","actionInsertDraft":"Insert in the composer","actionExpand":"Show the full prompt","actionCollapse":"Hide the full prompt","copied":"Copied","copyFailed":"The suggestion could not be copied.","editConfirm":"Send","editCancel":"Cancel","editPrompt":"The suggestion text","charsRemaining":"{n} characters left","charsOver":"{n} characters over the limit","sendConfirm":"Send this suggestion?","sendConfirmYes":"Send now","addSuggestion":"Add suggestion","manualPlaceholder":"Write your own suggestion","manualSave":"Save","manualCancel":"Cancel","generateNow":"Generate suggestions","generating":"Generating…","generatingElapsed":"Generating… {t}","undoDiscard":"Undo discard","srCopied":"The suggestion was copied to the clipboard.","srDiscarded":"The suggestion was discarded. Use Undo to bring it back.","srFavorited":"The suggestion was saved as a favourite.","srFavoriteEdited":"The favourite was updated.","srFavoritesCopied":"{n} favourites were copied to the clipboard.","srFavoritesRemoved":"{n} favourites were removed.","srEdited":"The edited suggestion was sent.","srSendConfirm":"The send is armed; click again to confirm.","srInserted":"The suggestion was placed in the composer draft.","srRestored":"The discarded suggestion was restored.","favoritesExport":"Export","favoritesExportJson":"Export JSON","srFavoritesExported":"Favourites exported.","srFavoritesImported":"{added} added, {updated} updated, {skipped} skipped.","favoritesExportFailed":"The favourites could not be exported.","favoritesImportFailed":"The file could not be imported.","testModel":"Test model","modelTesting":"Testing…","modelTestOk":"Available ({ms} ms)","modelTestFail":"Unavailable ({e})","generationFailed":"Generation failed: ","retryGeneration":"Try again","originLabel":"via {model} ({source})","sessionOptions":"Conversation options","sessionLangGlobal":"Same as global","sessionReset":"Reset","openSettings":"Open Nextsteps settings","settingsUnavailable":"Opening the settings is not available here.","actionMoveEarlier":"Move earlier","actionMoveLater":"Move later","srReordered":"The suggestion was moved.","srFavoritesReordered":"The favourites were reordered.","dragToReorder":"Drag to reorder","actionNewChat":"New conversation with this suggestion","newChatConfirm":"Start a new conversation with this suggestion?","newChatUnavailable":"Starting a new conversation is not available here.","insertDraftUnavailable":"Placing the suggestion in the composer is not available here.","actionRegenerate":"Regenerate","regenerating":"Regenerating…","srRegenerated":"The suggestion was regenerated.","updatePrecheck":"The version could not be verified on the npm registry.","updateNoManager":"No plugin installer is available in this host.","setRetention":"Retention","setRetentionTip":"Automatically delete stored suggestions older than this many days. 0 turns it off (0-365).","setTranscriptScope":"Transcript scope","setTranscriptScopeTip":"How much of the turn the generator sees. Minimal sends only the last user and assistant messages.","optTranscriptFull":"Full transcript","optTranscriptMinimal":"Minimal (last messages)","warnInjection":"This suggestion looks like a prompt-injection attempt","warnSecrets":"This suggestion looks like it contains a credential or secret","srSecretsWarning":"A suggestion looks like it contains a credential or secret.","sessionPrivate":"Private conversation","srPrivateOn":"This conversation is private; suggestions stay in memory only.","srPrivateOff":"This conversation is no longer private.","privatePurgeFailed":"The stored suggestions of this conversation could not be deleted; check the storage.","audit":"Audit log","auditEmpty":"No audited events yet.","auditClear":"Clear audit log","auditCleared":"The audit log was cleared.","auditKindGenerated":"generated","auditKindSent":"sent"},
      'pt-BR': {"header":"Sugestões de acompanhamento","srFollowupSent":"Follow-up enviado","sendFailed":"Não consegui enviar: ","intro":"Sugestões de próximos passos sob cada turno concluído do agente — um clique envia o followup.","setLanguage":"Idioma","setLanguageTip":"Os followups são gerados neste idioma. Automático segue a conversa; um idioma explícito usa uma chamada separada.","optAuto":"Automático (segue a conversa)","setModel":"Modelo","setModelTip":"O modelo que gera as sugestões. Automático usa o modelo da conversa dentro do turno; um idioma ou modelo explícito usa uma chamada separada.","optModelAuto":"Automático (mesmo modelo da conversa)","modelUnavailable":"Nenhuma lista de modelos disponível nesta instalação","setMax":"Followups por turno","setMaxTip":"Quantas sugestões o modelo deve produzir (1-6).","setHeader":"Mostrar cabeçalho","setHeaderTip":"O rótulo pequeno “Sugestões de acompanhamento” acima dos cartões.","setConfirmSend":"Confirmar antes de enviar","setConfirmSendTip":"O primeiro clique arma o envio e o segundo confirma; vale também para nova conversa.","update":"Atualizações","current":"Versão atual","check":"Verificar atualizações","checking":"Verificando…","upToDate":"Você está na versão mais recente","available":"Atualização disponível","open":"Abrir página da versão","none":"Nenhuma versão publicada ainda","updateNow":"Atualizar agora","installingMsg":"Instalando {v}...","installedMsg":"A versão {v} foi instalada. Reinicie o dsh para usá-la.","heldBackMsg":"A versão {v} foi instalada em vez da {asked} — o pnpm retém uma versão lançada há pouco tempo.","localDev":"Cópia de desenvolvimento local — atualize com git pull.","error":"Falha ao verificar atualizações","installError":"A atualização falhou","unsupportedVersion":"Essa versão não é uma versão que este plugin consiga instalar","repo":"Repositório no GitHub","issues":"Reportar um problema","setStyles":"Estilos de sugestão","setStylesTip":"Os ângulos que as sugestões devem cobrir. O gerador varia os prompts entre os estilos selecionados. Pelo menos um estilo permanece selecionado.","styleNextAction":"Próxima ação","styleExplore":"Explorar","styleDeepDive":"Aprofundar","setGenMode":"Geração","setGenModeTip":"Automático sugere os followups quando o turno termina; sob demanda espera pelo seu botão.","optGenAuto":"Automático (ao fim do turno)","optGenOnDemand":"Sob demanda (botão)","setBudget":"Orçamento de latência","setBudgetTip":"Quanto tempo o gerador pode rodar antes de a requisição ser abandonada (5000-120000 ms).","setMaxChars":"Tamanho da sugestão","setMaxCharsTip":"O número máximo de caracteres de uma sugestão (60-600).","metrics":"Desempenho","metricGeneration":"Geração","metricPersistence":"Persistência","metricRendering":"Renderização","metricAvg":"Média","metricMax":"Máximo","metricNoData":"Sem dados ainda","favorites":"Favoritos","favoritesEmpty":"Nenhuma sugestão favorita ainda.","favoritesSearch":"Buscar favoritos","favoriteCopy":"Copiar","favoriteRemove":"Remover","favoriteEdit":"Editar favorito","favoriteDuplicate":"Já existe um favorito com esse texto.","favoriteSelectAll":"Selecionar todos","favoriteCopySelected":"Copiar selecionados ({n})","favoriteRemoveSelected":"Remover selecionados ({n})","favoriteRemoveConfirm":"Confirmar a remoção de {n}","discarded":"Descartadas","discardedEmpty":"Nenhuma sugestão descartada.","discardRestore":"Restaurar","actionCopy":"Copiar","actionDiscard":"Descartar","actionFavorite":"Favoritar","actionEdit":"Editar","actionInsertDraft":"Inserir no compositor","actionExpand":"Mostrar o prompt completo","actionCollapse":"Ocultar o prompt completo","copied":"Copiado","copyFailed":"Não foi possível copiar a sugestão.","editConfirm":"Enviar","editCancel":"Cancelar","editPrompt":"O texto da sugestão","charsRemaining":"{n} caracteres restantes","charsOver":"{n} caracteres acima do limite","sendConfirm":"Enviar esta sugestão?","sendConfirmYes":"Enviar agora","addSuggestion":"Adicionar sugestão","manualPlaceholder":"Escreva sua própria sugestão","manualSave":"Salvar","manualCancel":"Cancelar","generateNow":"Gerar sugestões","generating":"Gerando…","generatingElapsed":"Gerando… {t}","undoDiscard":"Desfazer descarte","srCopied":"A sugestão foi copiada para a área de transferência.","srDiscarded":"A sugestão foi descartada. Use Desfazer para trazê-la de volta.","srFavorited":"A sugestão foi salva como favorita.","srFavoriteEdited":"O favorito foi atualizado.","srFavoritesCopied":"{n} favoritos foram copiados para a área de transferência.","srFavoritesRemoved":"{n} favoritos foram removidos.","srEdited":"A sugestão editada foi enviada.","srSendConfirm":"O envio está aguardando confirmação; clique novamente para confirmar.","srInserted":"A sugestão foi colocada no rascunho do compositor.","srRestored":"A sugestão descartada foi restaurada.","favoritesExport":"Exportar","favoritesExportJson":"Exportar JSON","srFavoritesExported":"Favoritos exportados.","srFavoritesImported":"{added} adicionados, {updated} atualizados, {skipped} ignorados.","favoritesExportFailed":"Não foi possível exportar os favoritos.","favoritesImportFailed":"Não foi possível importar o arquivo.","testModel":"Testar modelo","modelTesting":"Testando…","modelTestOk":"Disponível ({ms} ms)","modelTestFail":"Indisponível ({e})","generationFailed":"Falha ao gerar: ","retryGeneration":"Tentar novamente","originLabel":"via {model} ({source})","sessionOptions":"Opções da conversa","sessionLangGlobal":"Igual ao global","sessionReset":"Redefinir","openSettings":"Abrir as configurações do Nextsteps","settingsUnavailable":"Abrir as configurações não está disponível aqui.","actionMoveEarlier":"Mover para antes","actionMoveLater":"Mover para depois","srReordered":"A sugestão foi movida.","srFavoritesReordered":"Os favoritos foram reordenados.","dragToReorder":"Arraste para reordenar","actionNewChat":"Nova conversa com esta sugestão","newChatConfirm":"Iniciar uma nova conversa com esta sugestão?","newChatUnavailable":"Não foi possível iniciar uma nova conversa aqui.","insertDraftUnavailable":"Não foi possível colocar a sugestão no compositor aqui.","actionRegenerate":"Regenerar","regenerating":"Regenerando…","srRegenerated":"A sugestão foi regenerada.","updatePrecheck":"Não foi possível verificar a versão no registro do npm.","updateNoManager":"Nenhum instalador de plugins está disponível neste host.","setRetention":"Retenção","setRetentionTip":"Apaga automaticamente as sugestões armazenadas com mais dias que este valor. 0 desliga (0-365).","setTranscriptScope":"Escopo do histórico","setTranscriptScopeTip":"Quanto do turno o gerador enxerga. Mínimo envia apenas a última mensagem de usuário e de assistente.","optTranscriptFull":"Histórico completo","optTranscriptMinimal":"Mínimo (últimas mensagens)","warnInjection":"Esta sugestão parece uma tentativa de injeção de prompt","warnSecrets":"Esta sugestão parece conter uma credencial ou segredo","srSecretsWarning":"Uma sugestão parece conter uma credencial ou segredo.","sessionPrivate":"Conversa privada","srPrivateOn":"Esta conversa é privada; as sugestões ficam apenas em memória.","srPrivateOff":"Esta conversa não é mais privada.","privatePurgeFailed":"Não foi possível apagar as sugestões armazenadas desta conversa; verifique o armazenamento.","audit":"Registro de auditoria","auditEmpty":"Nenhum evento auditado ainda.","auditClear":"Apagar registro","auditCleared":"O registro de auditoria foi apagado.","auditKindGenerated":"gerado","auditKindSent":"enviado"},
      'zh-CN': {"header":"建议的后续操作","srFollowupSent":"后续操作已发送","sendFailed":"发送失败：","intro":"在每个智能体回合完成后的下方推荐下一步提示——单击即可发送。","setLanguage":"语言","setLanguageTip":"后续操作提示将以此语言生成。“自动”跟随对话语言;指定语言时使用单独调用。","optAuto":"自动（跟随对话）","setModel":"模型","setModelTip":"生成建议的模型。“自动”在回合内使用对话所用的模型;指定语言或模型时使用单独调用。","optModelAuto":"自动（与对话相同的模型）","modelUnavailable":"此安装没有可用的模型列表","setMax":"每回合提示数","setMaxTip":"模型应生成的建议提示数量（1-6）。","setHeader":"显示标题","setHeaderTip":"卡片上方的小标题“建议的后续操作”。","setConfirmSend":"发送前确认","setConfirmSendTip":"第一次点击进入待确认状态，第二次点击才会发送；同样适用于新建对话。","update":"更新","current":"当前版本","check":"检查更新","checking":"检查中…","upToDate":"已是最新版本","available":"有可用更新","open":"打开发布页","none":"尚未发布任何版本","updateNow":"立即更新","installingMsg":"正在安装 {v}...","installedMsg":"版本 {v} 已安装。重启 dsh 以使用。","heldBackMsg":"安装了版本 {v} 而不是 {asked} — pnpm 会暂缓过于新鲜的版本。","localDev":"本地开发副本 — 请用 git pull 更新。","error":"检查更新失败","installError":"更新失败","unsupportedVersion":"该版本不是此插件可安装的版本","repo":"GitHub 仓库","issues":"反馈问题","setStyles":"建议风格","setStylesTip":"建议应覆盖的角度。生成器会在所选风格之间变换提示。至少保留一种风格。","styleNextAction":"下一步行动","styleExplore":"探索","styleDeepDive":"深入","setGenMode":"生成方式","setGenModeTip":"自动会在回合结束时给出后续操作；按需则等待你点击按钮。","optGenAuto":"自动（回合结束时）","optGenOnDemand":"按需（按钮）","setBudget":"延迟预算","setBudgetTip":"生成器最多可以运行多久才会放弃请求（5000-120000 毫秒）。","setMaxChars":"建议长度","setMaxCharsTip":"一条建议的最大字符数（60-600）。","metrics":"性能","metricGeneration":"生成","metricPersistence":"持久化","metricRendering":"渲染","metricAvg":"平均","metricMax":"最大","metricNoData":"暂无数据","favorites":"收藏","favoritesEmpty":"还没有收藏的建议。","favoritesSearch":"搜索收藏","favoriteCopy":"复制","favoriteRemove":"移除","favoriteEdit":"编辑收藏","favoriteDuplicate":"已存在相同文本的收藏。","favoriteSelectAll":"全选","favoriteCopySelected":"复制所选（{n}）","favoriteRemoveSelected":"移除所选（{n}）","favoriteRemoveConfirm":"确认移除 {n} 条","discarded":"已丢弃","discardedEmpty":"没有已丢弃的建议。","discardRestore":"恢复","actionCopy":"复制","actionDiscard":"丢弃","actionFavorite":"收藏","actionEdit":"编辑","actionInsertDraft":"插入到输入框","actionExpand":"显示完整提示","actionCollapse":"隐藏完整提示","copied":"已复制","copyFailed":"无法复制这条建议。","editConfirm":"发送","editCancel":"取消","editPrompt":"建议文本","charsRemaining":"还可输入 {n} 个字符","charsOver":"超出限制 {n} 个字符","sendConfirm":"发送这条建议？","sendConfirmYes":"立即发送","addSuggestion":"添加建议","manualPlaceholder":"写下你自己的建议","manualSave":"保存","manualCancel":"取消","generateNow":"生成建议","generating":"正在生成…","generatingElapsed":"生成中… {t}","undoDiscard":"撤销丢弃","srCopied":"建议已复制到剪贴板。","srDiscarded":"建议已被丢弃。使用“撤销丢弃”可以恢复。","srFavorited":"建议已加入收藏。","srFavoriteEdited":"收藏已更新。","srFavoritesCopied":"{n} 条收藏已复制到剪贴板。","srFavoritesRemoved":"已移除 {n} 条收藏。","srEdited":"编辑后的建议已发送。","srSendConfirm":"发送已待确认；再次点击以确认。","srInserted":"建议已放入输入框草稿。","srRestored":"已丢弃的建议已恢复。","favoritesExport":"导出","favoritesExportJson":"导出 JSON","srFavoritesExported":"收藏已导出。","srFavoritesImported":"新增 {added} 条，更新 {updated} 条，跳过 {skipped} 条。","favoritesExportFailed":"无法导出收藏。","favoritesImportFailed":"无法导入该文件。","testModel":"测试模型","modelTesting":"测试中…","modelTestOk":"可用（{ms} 毫秒）","modelTestFail":"不可用（{e}）","generationFailed":"生成失败：","retryGeneration":"重试","originLabel":"由 {model}（{source}）生成","sessionOptions":"会话选项","sessionLangGlobal":"跟随全局","sessionReset":"重置","openSettings":"打开 Nextsteps 设置","settingsUnavailable":"此处无法打开设置。","actionMoveEarlier":"前移","actionMoveLater":"后移","srReordered":"建议已移动。","srFavoritesReordered":"收藏已重新排序。","dragToReorder":"拖动以重新排序","actionNewChat":"用此建议新建对话","newChatConfirm":"用这条建议新建对话？","newChatUnavailable":"此处无法新建对话。","insertDraftUnavailable":"此处无法将建议放入输入框。","actionRegenerate":"重新生成","regenerating":"正在重新生成…","srRegenerated":"建议已重新生成。","updatePrecheck":"无法在 npm registry 上验证该版本。","updateNoManager":"此宿主没有可用的插件安装器。","setRetention":"保留期限","setRetentionTip":"自动删除超过此天数的已存建议。0 表示关闭（0-365）。","setTranscriptScope":"历史记录范围","setTranscriptScopeTip":"生成器能看到多少回合内容。最小模式只发送最后一条用户和助手消息。","optTranscriptFull":"完整历史记录","optTranscriptMinimal":"最小（最后几条）","warnInjection":"这条建议疑似提示词注入","warnSecrets":"这条建议疑似包含凭据或密钥","srSecretsWarning":"有建议疑似包含凭据或密钥。","sessionPrivate":"私人对话","srPrivateOn":"此对话为私人模式；建议仅保留在内存中。","srPrivateOff":"此对话不再是私人模式。","privatePurgeFailed":"无法删除此对话的已存建议；请检查存储。","audit":"审计日志","auditEmpty":"尚无审计事件。","auditClear":"清空审计日志","auditCleared":"审计日志已清空。","auditKindGenerated":"生成","auditKindSent":"发送"}
    };
    const DEFAULT_SETTINGS = {
      lang: 'auto',
      maxFollowups: 3,
      showHeader: true,
      model: '',
      styles: [...STYLE_IDS],
      generationMode: 'auto',
      latencyBudgetMs: LATENCY_DEFAULT_MS,
      maxSuggestionChars: CHARS_DEFAULT,
      retentionDays: 0,
      transcriptScope: 'full',
      confirmBeforeSend: false
    };
    let pluginSettings = { ...DEFAULT_SETTINGS };
    let updateManager = undefined;

    let pluginVersion;

    const hostMode = (settings) => !(settings.lang === 'auto' && (typeof settings.model !== 'string' || settings.model === ''));
    const hostModeFor = (sessionId) => {
      const override = sessionOverrideOf(sessionId);
      if (override !== undefined && ((typeof override.lang === 'string' && override.lang !== '') || Number.isInteger(override.maxFollowups) || (typeof override.model === 'string' && override.model !== ''))) return true;
      return hostMode(pluginSettings);
    };

    function settingsSignature(settings) {
      return JSON.stringify([
        settings.lang,
        settings.model,
        settings.maxFollowups,
        settings.showHeader,
        settings.styles,
        settings.generationMode,
        settings.latencyBudgetMs,
        settings.maxSuggestionChars,
        settings.transcriptScope
      ]);
    }

    function applySettings(next) {
      const merged = { ...DEFAULT_SETTINGS, ...next };
      if (settingsSignature(merged) !== settingsSignature(pluginSettings)) settingsRevision += 1;
      pluginSettings = merged;
      return pluginSettings;
    }

    async function responseJson(response) {
      try {
        return await response.json();
      } catch {
        return undefined;
      }
    }
    async function refreshPluginSettings() {
      try {
        const response = await fetch(SETTINGS_ROUTE, { cache: 'no-store' });
        const data = await responseJson(response);
        if (data !== null && typeof data === 'object' && data.ok === true && data.settings !== null && typeof data.settings === 'object') {
          applySettings(data.settings);
          if (typeof data.version === 'string') {
            pluginVersion = data.version;
            const record = remembered();
            if (record !== '' && versionOf(pluginVersion) !== undefined && !isNewer(record, pluginVersion)) forget();
          }
        }
      } catch (error) {
        console.warn('dsh-nextsteps: settings unavailable:', error);
      }
      return pluginSettings;
    }

    function createSettings(ctx) {
      return function NextstepsSettings(props) {
        let t;
        try {
          t = typeof props.t === 'function' ? props.t : ctx.locale.bind(NS);
        } catch {
          t = (key) => DICTIONARIES.en[key] ?? key;
        }
        const [settings, setSettings] = React.useState(pluginSettings);
        const [updateState, setUpdateState] = React.useState({ version: '', update: null, checking: false, installing: false, installed: '', installError: '', asked: '' });
        const [local, setLocal] = React.useState(() => ({ favorites: readFavorites(), discarded: readDiscarded() }));
        const [audit, setAudit] = React.useState(() => readAudit());
        const [localNotice, setLocalNotice] = React.useState('');
        const [favQuery, setFavQuery] = React.useState('');
        const [editingFav, setEditingFav] = React.useState(null);
        const [selectedFavs, setSelectedFavs] = React.useState(() => new Set());
        const [bulkRemoveArmed, setBulkRemoveArmed] = React.useState(false);
        const [auditClearArmed, setAuditClearArmed] = React.useState(false);
        const bulkTimersRef = React.useRef(new Set());
        const auditTimersRef = React.useRef(new Set());

        React.useEffect(() => () => {
          for (const timerId of bulkTimersRef.current) window.clearTimeout(timerId);
          bulkTimersRef.current.clear();
          for (const timerId of auditTimersRef.current) window.clearTimeout(timerId);
          auditTimersRef.current.clear();
        }, []);
        React.useEffect(() => {
          refreshPluginSettings().then((loaded) => setSettings({ ...loaded }));
          checkUpdate();
        }, []);
        const [models, setModels] = React.useState(() => modelCatalogCache);
        React.useEffect(() => {
          let alive = true;
          loadModelCatalog(true).then((catalog) => { if (alive) setModels(catalog); });
          return () => { alive = false; };
        }, []);
        const [modelTest, setModelTest] = React.useState({ phase: 'idle', ms: 0, error: '' });
        const save = async (patch) => {
          const merged = { ...settings, ...patch };
          setSettings(merged);
          try {
            const response = await fetch(SETTINGS_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
            const data = await responseJson(response);
            if (data !== null && typeof data === 'object' && data.ok === true && data.settings !== null && typeof data.settings === 'object') {
              applySettings(data.settings);
              setSettings(pluginSettings);
            }
          } catch (error) {
            console.warn('dsh-nextsteps: settings save failed:', error);
          }
        };
        const refreshLocal = () => setLocal({ favorites: readFavorites(), discarded: readDiscarded() });
        const clearAudit = () => {
          if (auditClearArmed !== true) {
            setAuditClearArmed(true);
            const timerId = window.setTimeout(() => {
              auditTimersRef.current.delete(timerId);
              setAuditClearArmed(false);
            }, CONFIRM_RESET_MS);
            auditTimersRef.current.add(timerId);
            return;
          }
          for (const timerId of auditTimersRef.current) window.clearTimeout(timerId);
          auditTimersRef.current.clear();
          setAuditClearArmed(false);
          pendingWrites.delete(AUDIT_KEY);
          removeNow(AUDIT_KEY);
          setAudit([]);
          setLocalNotice(t('auditCleared'));
        };
        const saveFavoriteEdit = () => {
          if (editingFav === null) return;
          const nextPrompt = editingFav.draft.trim();
          if (nextPrompt === '') return;
          const favId = editingFav.favId;
          const nextHash = contentHash(nextPrompt);
          const store = readFavorites();
          const old = store[favId];
          if (favId !== nextHash && store[nextHash] !== undefined) {
            setLocalNotice(t('favoriteDuplicate'));
            return;
          }
          delete store[favId];
          store[nextHash] = { prompt: nextPrompt, label: old?.label ?? null, at: old?.at ?? Date.now() };
          scheduleWrite(FAVORITES_KEY, JSON.stringify(store));
          if (favId !== nextHash) {
            const order = readFavoritesOrder();
            const at = order.indexOf(favId);
            if (at !== -1) {
              order[at] = nextHash;
              writeFavoritesOrder(order);
            }
          }
          refreshLocal();
          setEditingFav(null);
          setLocalNotice(t('srFavoriteEdited'));
        };
        const copySelectedFavorites = async () => {
          const prompts = visibleFavoriteEntries
            .filter(([favId]) => selectedFavs.has(favId))
            .map(([, value]) => (typeof value?.prompt === 'string' ? value.prompt : ''))
            .filter((prompt) => prompt !== '');
          if (prompts.length === 0) return;
          const copied = await copyText(prompts.join('\n\n'));
          setLocalNotice(copied ? t('srFavoritesCopied').replace('{n}', String(prompts.length)) : t('copyFailed'));
        };
        const removeSelectedFavorites = () => {
          const ids = [...selectedFavs];
          if (ids.length === 0) return;
          if (bulkRemoveArmed !== true) {
            setBulkRemoveArmed(true);
            const timerId = window.setTimeout(() => {
              bulkTimersRef.current.delete(timerId);
              setBulkRemoveArmed(false);
            }, CONFIRM_RESET_MS);
            bulkTimersRef.current.add(timerId);
            return;
          }
          for (const timerId of bulkTimersRef.current) window.clearTimeout(timerId);
          bulkTimersRef.current.clear();
          setBulkRemoveArmed(false);
          const store = readFavorites();
          for (const favId of ids) delete store[favId];
          scheduleWrite(FAVORITES_KEY, JSON.stringify(store));
          const order = readFavoritesOrder().filter((favId) => store[favId] !== undefined);
          if (order.length !== readFavoritesOrder().length) writeFavoritesOrder(order);
          refreshLocal();
          setSelectedFavs(new Set());
          setLocalNotice(t('srFavoritesRemoved').replace('{n}', String(ids.length)));
        };
        const toggleFavoriteSelected = (favId) => {
          setSelectedFavs((previous) => {
            const next = new Set(previous);
            if (next.has(favId)) next.delete(favId);
            else next.add(favId);
            return next;
          });
        };
        const exportFavorites = () => {
          try {
            const markdown = buildFavoritesMarkdown(readFavorites(), readFavoritesOrder());
            const blob = new Blob([markdown], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'dsh-nextsteps-favorites-' + new Date().toISOString().slice(0, 10) + '.md';
            anchor.click();
            window.setTimeout(() => {
              try {
                if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
              } catch (error) {
                console.warn('dsh-nextsteps: the blob url could not be revoked:', error);
              }
            }, 0);
          } catch (error) {
            console.warn('dsh-nextsteps: the favourites export failed:', error);
            setLocalNotice(t('favoritesExportFailed'));
            return;
          }
          setLocalNotice(t('srFavoritesExported'));
        };
        const exportFavoritesJson = () => {
          try {
            const json = buildFavoritesJson(readFavorites(), readFavoritesOrder());
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'dsh-nextsteps-favorites-' + new Date().toISOString().slice(0, 10) + '.json';
            anchor.click();
            window.setTimeout(() => {
              try {
                if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
              } catch (error) {
                console.warn('dsh-nextsteps: the blob url could not be revoked:', error);
              }
            }, 0);
          } catch (error) {
            console.warn('dsh-nextsteps: the favourites export failed:', error);
            setLocalNotice(t('favoritesExportFailed'));
            return;
          }
          setLocalNotice(t('srFavoritesExported'));
        };
        const importFavorites = async (event) => {
          const input = event.target;
          const file = input?.files?.[0];
          if (input !== null && typeof input === 'object' && 'value' in input) input.value = '';
          if (file === undefined || file === null) return;
          try {
            if (file.size > 1048576) throw new Error('the file is larger than 1 MiB');
            const raw = await file.text();
            let parsed;
            try {
              parsed = JSON.parse(raw);
            } catch {
              throw new Error('the file is not valid json');
            }
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.favorites === null || typeof parsed.favorites !== 'object' || Array.isArray(parsed.favorites)) {
              throw new Error('the file carries no favourites object');
            }
            const store = readFavorites();
            let added = 0;
            let updated = 0;
            let skipped = 0;
            const additions = [];
            for (const entry of Object.values(parsed.favorites)) {
              if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
              if (typeof entry.prompt !== 'string' || entry.prompt.trim() === '') continue;
              if (entry.label !== null && typeof entry.label !== 'string') continue;
              if (typeof entry.at !== 'number' || !Number.isFinite(entry.at)) continue;
              const hash = contentHash(entry.prompt);
              const current = store[hash];
              if (current === undefined) {
                store[hash] = { prompt: entry.prompt, label: entry.label, at: entry.at };
                additions.push(hash);
                added += 1;
              } else if (entry.at > current.at) {
                store[hash] = { prompt: entry.prompt, label: entry.label, at: entry.at };
                updated += 1;
              } else {
                skipped += 1;
              }
            }
            scheduleWrite(FAVORITES_KEY, JSON.stringify(store));
            if (additions.length > 0) {
              const savedOrder = readFavoritesOrder().filter((favId) => store[favId] !== undefined);
              const fileOrder = Array.isArray(parsed.order)
                ? parsed.order.filter((favId) => typeof favId === 'string' && favId !== '' && store[favId] !== undefined && !savedOrder.includes(favId) && !additions.includes(favId))
                : [];
              writeFavoritesOrder([...savedOrder, ...fileOrder, ...additions.filter((favId) => !fileOrder.includes(favId))]);
            }
            refreshLocal();
            setLocalNotice(t('srFavoritesImported').replace('{added}', String(added)).replace('{updated}', String(updated)).replace('{skipped}', String(skipped)));
          } catch (error) {
            console.warn('dsh-nextsteps: the favourites import failed:', error);
            setLocalNotice(t('favoritesImportFailed'));
          }
        };
        const runModelTest = async () => {
          setModelTest({ phase: 'testing', ms: 0, error: '' });
          try {
            const response = await fetch(MODEL_TEST_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: settings.model }) });
            const data = await responseJson(response);
            if (data !== null && typeof data === 'object' && data.ok === true) setModelTest({ phase: 'ok', ms: Number(data.latencyMs) || 0, error: '' });
            else setModelTest({ phase: 'fail', ms: 0, error: String(data?.error ?? 'unknown') });
          } catch (error) {
            setModelTest({ phase: 'fail', ms: 0, error: String(error?.message ?? error) });
          }
        };
        const checkUpdate = async () => {
          setUpdateState((prev) => ({ ...prev, checking: true }));
          try {
            await resolveApiBase();
            const r = await fetch(API_BASE + '/.ns/update', { cache: 'no-store', headers: authHeaders(), signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS) });
            const j = await r.json();
            if (j.update?.error !== undefined) {
              setUpdateState((prev) => ({ ...prev, checking: false, update: j.update, version: j.version ?? prev.version }));
              return;
            }
            if (!r.ok || j.update === undefined || j.update === null) {
              setUpdateState((prev) => ({ ...prev, checking: false, update: { error: typeof j.error === 'string' ? j.error : `http ${r.status}` } }));
              return;
            }
            setUpdateState((prev) => ({ ...prev, checking: false, update: j.update, version: j.version ?? prev.version }));
          } catch {
            const pending = remembered();
            setUpdateState((prev) => (pending === ''
              ? { ...prev, checking: false, update: { error: 'unreachable' } }
              : { ...prev, checking: false, installed: pending }));
          }
        };

        const precheckPackument = async (version) => {
          try {
            const response = await fetch('https://registry.npmjs.org/dsh-nextsteps/' + version, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
            if (response.status !== 200) return false;
            const j = await responseJson(response);
            if (j === null || typeof j !== 'object') return false;
            return typeof j?.dist?.integrity === 'string' && /^sha512-[A-Za-z0-9+/=]{40,}$/.test(j.dist.integrity);
          } catch {
            return false;
          }
        };

        const askHostToInstall = async (latest, requestId) => {
          const canUpdate = updateManager !== undefined && typeof updateManager.updateBundle === 'function';
          const canInstall = updateManager !== undefined && typeof updateManager.installBundle === 'function';
          if (!canUpdate && !canInstall) return undefined;
          const installSpec = async (spec) => {
            const reply = await updateManager.installBundle(spec, { requestId });
            if (!reply?.ok) throw new Error(reply?.error?.message ?? 'plugin manager did not answer');
            return reply.value;
          };
          const refuse = (result) => {
            const refusal = String(result?.error?.diagnostic ?? '').split('\n').map((line) => line.trim()).filter((line) => line !== '');
            const why = refusal.find((line) => line.startsWith('dsh:')) ?? refusal.at(-1) ?? result?.error?.code ?? 'install failed';
            setUpdateState((prev) => ({ ...prev, installing: false, installed: '', asked: '', installError: String(why).slice(0, 160) }));
            return { application: 'refused' };
          };
          const landedOnDisk = (result) => typeof result?.version === 'string' && versionOf(result.version) !== undefined;
          if (canUpdate) {
            const reply = await updateManager.updateBundle(NS, latest, { requestId });
            if (!reply?.ok) throw new Error(reply?.error?.message ?? 'plugin manager did not answer');
            const result = reply.value?.result ?? reply.value;
            if (result?.application !== 'failed' && result?.application !== 'cancelled') return result;
            if (landedOnDisk(result)) return result;
            if (result?.error?.code === 'invalid-spec') throw new Error('the plugin manager rejected the install spec');
            if (result?.error?.code === 'already-installed') return undefined;
            return refuse(result);
          }
          const result = await installSpec(NS + '@' + latest);
          if (result?.application !== 'failed' && result?.application !== 'cancelled') return result;
          if (landedOnDisk(result)) return result;
          if (result?.error?.code === 'already-installed') return undefined;
          return refuse(result);
        };

        const installUpdate = async () => {
          const latest = (updateState.update?.latest ?? '').replace(/^v/, '');
          if (versionOf(latest) === undefined) {
            setUpdateState((prev) => ({ ...prev, installing: false, installError: 'unsupported-version' }));
            return;
          }
          const hasManager = updateManager !== undefined && (typeof updateManager.updateBundle === 'function' || typeof updateManager.installBundle === 'function');
          if (!hasManager) {
            setUpdateState((prev) => ({ ...prev, installing: false, installError: 'no-installer' }));
            return;
          }
          setUpdateState((prev) => ({ ...prev, installing: true, installed: '', installError: '' }));
          const requestId = NS + '-update-' + latest + '-' + Date.now();
          try {
            const verified = await precheckPackument(latest);
            if (verified !== true) {
              setUpdateState((prev) => ({ ...prev, installing: false, installError: 'precheck' }));
              return;
            }
            const result = await askHostToInstall(latest, requestId);
            if (result === undefined) {
              remember(latest);
              setUpdateState((prev) => ({ ...prev, installing: false, installed: latest, asked: latest }));
              return;
            }
            if (result.application === 'refused') return;
            const lines = String(result?.error?.diagnostic ?? '').split('\n').map((line) => line.trim()).filter((line) => line !== '');
            const reason = lines.find((line) => line.startsWith('dsh:')) ?? lines.at(-1) ?? result?.error?.code ?? 'install failed';
            const live = result?.application === 'applied';
            const overridden = result?.application === 'overridden';
            const reported = typeof result?.version === 'string' && versionOf(result.version) !== undefined ? result.version : undefined;
            if (!live && !overridden && result?.application !== 'restart-required' && reported === undefined) {
              setUpdateState((prev) => ({ ...prev, installing: false, installError: String(reason).slice(0, 160) }));
              return;
            }
            const landed = reported ?? latest;
            remember(landed);
            if (live) {
              setUpdateState((prev) => ({ ...prev, installing: false, installed: '', version: landed, asked: '', update: prev.update === null ? prev.update : { ...prev.update, newer: false } }));
              return;
            }
            const startFailed = result?.application === 'failed';
            setUpdateState((prev) => ({ ...prev, installing: false, installed: landed, asked: latest, installError: startFailed ? String(reason).slice(0, 160) : '' }));
            return;
          } catch (error) {
            setUpdateState((prev) => ({ ...prev, installing: false, installError: String(error?.message ?? error).slice(0, 160) }));
          }
        };

        const u = updateState.update;
        const pendingVersion = [updateState.installed, u?.installed]
          .filter((value) => typeof value === 'string' && versionOf(value) !== undefined)
          .reduce((best, value) => (best === undefined || isNewer(value, best) ? value : best), undefined);
        const runningVersion = updateState.version || pluginVersion;
        const pendingIsNewer = pendingVersion !== undefined && (versionOf(runningVersion) === undefined || compareVersions(pendingVersion, runningVersion) > 0);
        const heldBack = pendingVersion !== undefined && versionOf(runningVersion) !== undefined && compareVersions(pendingVersion, runningVersion) <= 0 && versionOf(updateState.asked ?? '') !== undefined && isNewer(updateState.asked, pendingVersion);
        const pendingMsg = heldBack ? t('heldBackMsg').replace('{v}', pendingVersion).replace('{asked}', updateState.asked) : t('installedMsg').replace('{v}', pendingVersion);
        const updateStatus = u === null ? t('none') : u.error ? t('error') + ' (' + u.error + ')' : updateState.installing ? t('installingMsg').replace('{v}', (u.latest ?? '').replace(/^v/, '')) : u.newer ? t('available') + ': ' + u.latest : t('upToDate');
        const controlStyle = { background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '5px 8px', fontSize: 13 };
        const linkStyle = { background: 'none', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '5px 10px', color: 'var(--dsw-alias-label-primary)', fontSize: 12, cursor: 'pointer', textDecoration: 'none' };
        const row = (label, tip, control, key) => h('div', { key, title: tip, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '14px 0', borderBottom: '.5px solid var(--dsw-alias-border-l1)', flexWrap: 'wrap' } },
          h('div', { style: { minWidth: 0 } },
            h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, label),
            tip === '' ? null : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 } }, tip)),
          h('div', { style: { flex: 'none', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' } }, control));

        const selectedStyles = Array.isArray(settings.styles)
          ? (() => {
            const valid = settings.styles.filter((id) => STYLE_IDS.includes(id));
            return valid.length > 0 ? valid : pluginSettings.styles.filter((id) => STYLE_IDS.includes(id));
          })()
          : [...STYLE_IDS];
        const toggleStyle = (id, enabled) => {
          const next = enabled ? [...selectedStyles, id] : selectedStyles.filter((entry) => entry !== id);
          if (next.length === 0) return;
          save({ styles: next });
        };
        const styleRows = [
          { id: 'next-action', label: t('styleNextAction') },
          { id: 'explore', label: t('styleExplore') },
          { id: 'deep-dive', label: t('styleDeepDive') }
        ];
        const generationMode = GENERATION_MODES.includes(settings.generationMode) ? settings.generationMode : 'auto';
        const latencyBudget = Math.min(LATENCY_MAX_MS, Math.max(LATENCY_MIN_MS, Number(settings.latencyBudgetMs) || LATENCY_DEFAULT_MS));
        const maxChars = Math.min(CHARS_MAX, Math.max(CHARS_MIN, Number(settings.maxSuggestionChars) || CHARS_DEFAULT));

        const metrics = readMetrics();
        const metricRows = [
          { label: t('metricGeneration'), samples: metrics.generation },
          { label: t('metricPersistence'), samples: metrics.persistence },
          { label: t('metricRendering'), samples: metrics.rendering }
        ];
        const metricTable = h('table', { style: { borderCollapse: 'collapse', fontSize: 12 } },
          h('thead', null, h('tr', null,
            h('th', { style: { textAlign: 'left', padding: '2px 12px 2px 0' } }, t('metrics')),
            h('th', { style: { textAlign: 'left', padding: '2px 12px 2px 0' } }, t('metricAvg')),
            h('th', { style: { textAlign: 'left', padding: '2px 12px 2px 0' } }, t('metricMax')))),
          h('tbody', null, metricRows.map((rowData) => {
            const samples = rowData.samples;
            const total = samples.reduce((sum, value) => sum + value, 0);
            const average = samples.length === 0 ? 0 : Math.round(total / samples.length);
            const maximum = samples.length === 0 ? 0 : Math.max(...samples);
            return h('tr', { key: rowData.label },
              h('td', { style: { padding: '2px 12px 2px 0' } }, `${rowData.label} (${samples.length})`),
              samples.length === 0 ? h('td', { colSpan: 2, style: { padding: '2px 12px 2px 0' } }, t('metricNoData')) : null,
              samples.length === 0 ? null : h('td', { style: { padding: '2px 12px 2px 0' } }, `${average} ms`),
              samples.length === 0 ? null : h('td', { style: { padding: '2px 12px 2px 0' } }, `${maximum} ms`));
          })));

        const favoriteEntries = Object.entries(local.favorites);
        const discardedEntries = Object.entries(local.discarded);
        const favQueryLower = favQuery.toLowerCase();
        const orderedFavoriteList = orderedFavoriteEntries(local.favorites, readFavoritesOrder());
        const visibleFavoriteEntries = favQueryLower === '' ? orderedFavoriteList : orderedFavoriteList.filter(([, value]) => {
          const prompt = String(value?.prompt ?? '').toLowerCase();
          const label = String(value?.label ?? '').toLowerCase();
          return prompt.includes(favQueryLower) || label.includes(favQueryLower);
        });
        const allVisibleSelected = visibleFavoriteEntries.length > 0 && visibleFavoriteEntries.every(([favId]) => selectedFavs.has(favId));
        const toggleAllVisibleFavorites = (event) => {
          setSelectedFavs((previous) => {
            const next = new Set(previous);
            for (const [favId] of visibleFavoriteEntries) {
              if (event.target.checked === true) next.add(favId);
              else next.delete(favId);
            }
            return next;
          });
        };
        const favoriteOrderIds = () => orderedFavoriteEntries(readFavorites(), readFavoritesOrder()).map(([favId]) => favId);
        const moveFavTo = (draggedId, targetId, before = false) => {
          if (draggedId === targetId) return;
          const ids = favoriteOrderIds();
          const from = ids.indexOf(draggedId);
          const to = ids.indexOf(targetId);
          if (from === -1 || to === -1) return;
          const insertAt = before ? (from < to ? to - 1 : to) : (from < to ? to : to + 1);
          ids.splice(insertAt, 0, ids.splice(from, 1)[0]);
          writeFavoritesOrder(ids);
          refreshLocal();
          setLocalNotice(t('srFavoritesReordered'));
        };
        const moveFavBy = (favId, delta) => {
          const ids = favoriteOrderIds();
          const from = ids.indexOf(favId);
          const to = from + delta;
          if (from === -1 || to < 0 || to >= ids.length) return;
          ids.splice(to, 0, ids.splice(from, 1)[0]);
          writeFavoritesOrder(ids);
          refreshLocal();
          setLocalNotice(t('srFavoritesReordered'));
        };
        const favDragRef = React.useRef(null);
        const startFavDrag = (event, favId) => {
          if (favDragRef.current !== null) return;
          const pointerId = event.pointerId;
          const startX = event.clientX;
          const startY = event.clientY;
          const drag = { pointerId, active: false, targetId: undefined, target: null, detach: null };
          const onMove = (moveEvent) => {
            if (moveEvent.pointerId !== drag.pointerId || favDragRef.current !== drag) return;
            if (drag.active === false) {
              const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
              if (distance < DRAG_THRESHOLD_PX) return;
              drag.active = true;
            }
            const hit = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(moveEvent.clientX, moveEvent.clientY) : [];
            let nextTarget;
            for (const element of hit) {
              const id = element?.dataset?.favId;
              if (typeof id === 'string' && id !== '' && id !== favId) {
                nextTarget = [id, element];
                break;
              }
            }
            if (nextTarget !== undefined) {
              drag.targetId = nextTarget[0];
              drag.target = nextTarget[1];
            }
          };
          const settle = (endEvent, commit) => {
            if (endEvent.pointerId !== drag.pointerId) return;
            drag.detach();
            if (favDragRef.current === drag) favDragRef.current = null;
            if (commit === true && drag.active === true && typeof drag.targetId === 'string') {
              const rect = drag.target?.getBoundingClientRect?.();
              const before = rect !== undefined ? endEvent.clientY < (rect.top + rect.bottom) / 2 : false;
              moveFavTo(favId, drag.targetId, before);
            }
          };
          const onUp = (upEvent) => settle(upEvent, true);
          const onCancel = (cancelEvent) => settle(cancelEvent, false);
          drag.detach = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onCancel);
          };
          favDragRef.current = drag;
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
          document.addEventListener('pointercancel', onCancel);
        };
        const favoriteList = favoriteEntries.length === 0
          ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('favoritesEmpty'))
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 420 } }, visibleFavoriteEntries.map(([favId, value]) => h('div', { key: favId, 'data-fav-id': favId, style: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' } },
            favQuery === '' ? h('span', {
              className: 'dsh-sf-grip',
              title: t('dragToReorder'),
              'aria-hidden': true,
              onPointerDown: (event) => startFavDrag(event, favId)
            }, '⠿') : null,
            h('input', {
              type: 'checkbox',
              checked: selectedFavs.has(favId),
              'aria-label': typeof value?.prompt === 'string' ? value.prompt : '',
              onChange: () => toggleFavoriteSelected(favId)
            }),
            editingFav?.favId === favId ? h('span', { style: { display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 } },
              h('textarea', {
                className: 'dsh-sf-textarea',
                'aria-label': t('editPrompt'),
                value: editingFav.draft,
                onChange: (event) => setEditingFav({ favId, draft: event.target.value })
              }),
              h('span', { style: { display: 'flex', gap: 6 } },
                h('button', { type: 'button', className: 'dsh-sf-action', onClick: saveFavoriteEdit }, t('manualSave')),
                h('button', { type: 'button', className: 'dsh-sf-action', onClick: () => setEditingFav(null) }, t('manualCancel'))))
            : h('span', { style: { fontSize: 12 } }, typeof value?.prompt === 'string' ? value.prompt : String(value?.label ?? '')),
            h('span', { style: { display: 'flex', gap: 6 } },
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                onClick: async () => {
                  const prompt = typeof value?.prompt === 'string' ? value.prompt : '';
                  if (prompt === '') return;
                  const copied = await copyText(prompt);
                  setLocalNotice(copied ? t('srCopied') : t('copyFailed'));
                }
              }, t('favoriteCopy')),
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': t('favoriteEdit'),
                title: t('favoriteEdit'),
                onClick: () => setEditingFav({ favId, draft: typeof value?.prompt === 'string' ? value.prompt : '' })
              }, '✎'),
              h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                onClick: () => {
                  const store = readFavorites();
                  delete store[favId];
                  scheduleWrite(FAVORITES_KEY, JSON.stringify(store));
                  const order = readFavoritesOrder();
                  const at = order.indexOf(favId);
                  if (at !== -1) {
                    order.splice(at, 1);
                    writeFavoritesOrder(order);
                  }
                  refreshLocal();
                }
              }, t('favoriteRemove')),
              favQuery === '' ? h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': t('actionMoveEarlier'),
                title: t('actionMoveEarlier'),
                onClick: () => moveFavBy(favId, -1)
              }, '↑') : null,
              favQuery === '' ? h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': t('actionMoveLater'),
                title: t('actionMoveLater'),
                onClick: () => moveFavBy(favId, 1)
              }, '↓') : null))));
        const discardedList = discardedEntries.length === 0
          ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('discardedEmpty'))
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 420 } }, discardedEntries.map(([captureKey, value]) => h('div', { key: captureKey, style: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' } },
            h('span', { style: { fontSize: 12 } }, typeof value?.prompt === 'string' ? value.prompt : String(value?.label ?? '')),
            h('button', {
              type: 'button',
              className: 'dsh-sf-action',
              onClick: () => {
                const store = storeStateForWrite(DISCARDED_KEY, readDiscarded, {});
                delete store[captureKey];
                scheduleWrite(DISCARDED_KEY, JSON.stringify(store));
                refreshLocal();
              }
            }, t('discardRestore')))));

        return h('div', { 'data-dsh-nextsteps-settings': '' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8 } },
            h('img', { src: ICON_DATAURI, width: 96, height: 54, alt: '', style: { borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)', flex: 'none' } }),
            h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: '18px' } }, t('intro'))),
          row(t('setLanguage'), t('setLanguageTip'), h('select', { value: settings.lang, onChange: (event) => save({ lang: event.target.value }), style: controlStyle, 'aria-label': t('setLanguage') },
                      h('option', { value: 'auto' }, t('optAuto')),
          ...LANGUAGE_OPTIONS.map((option) => h('option', { key: option.value, value: option.value }, option.label))), 'lang'),
          row(t('setModel'), t('setModelTip'), models === undefined ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('checking')) : (models.groups ?? []).length === 0 ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('modelUnavailable')) : h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
            h('select', { value: settings.model, onChange: (event) => save({ model: event.target.value }), style: controlStyle, 'aria-label': t('setModel') },
              h('option', { value: '' }, t('optModelAuto')),
              ...(models.groups ?? []).map((group) => h('optgroup', { key: group.id, label: group.name },
                group.models.map((entry) => h('option', { key: group.id + '/' + entry.id, value: group.id + '/' + entry.id }, entry.name === entry.id ? entry.name : entry.name + ' (' + entry.id + ')'))))),
            h('button', { type: 'button', className: 'dsh-sf-action', disabled: modelTest.phase === 'testing', onClick: runModelTest }, t('testModel')),
            h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, modelTest.phase === 'testing' ? t('modelTesting') : modelTest.phase === 'ok' ? t('modelTestOk').replace('{ms}', String(modelTest.ms)) : modelTest.phase === 'fail' ? t('modelTestFail').replace('{e}', modelTest.error) : '')), 'model'),
          row(t('setMax'), t('setMaxTip'), h('input', { type: 'number', min: 1, max: 6, value: settings.maxFollowups, onChange: (event) => save({ maxFollowups: Number(event.target.value) }), style: { ...controlStyle, width: 64 }, 'aria-label': t('setMax') }), 'max'),
          row(t('setStyles'), t('setStylesTip'), h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } }, styleRows.map((entry) => h('label', { key: entry.id, style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 } },
            h('input', { type: 'checkbox', checked: selectedStyles.includes(entry.id), onChange: (event) => toggleStyle(entry.id, event.target.checked), 'aria-label': entry.label }),
            entry.label))), 'styles'),
          row(t('setGenMode'), t('setGenModeTip'), h('select', { value: generationMode, onChange: (event) => save({ generationMode: event.target.value }), style: controlStyle, 'aria-label': t('setGenMode') },
            h('option', { value: 'auto' }, t('optGenAuto')),
            h('option', { value: 'on-demand' }, t('optGenOnDemand'))), 'genmode'),
          row(t('setTranscriptScope'), t('setTranscriptScopeTip'), h('select', { value: settings.transcriptScope, onChange: (event) => save({ transcriptScope: event.target.value }), style: controlStyle, 'aria-label': t('setTranscriptScope') },
            h('option', { value: 'full' }, t('optTranscriptFull')),
            h('option', { value: 'minimal' }, t('optTranscriptMinimal'))), 'transcriptscope'),
          row(t('setBudget'), t('setBudgetTip'), h('input', { type: 'number', min: LATENCY_MIN_MS, max: LATENCY_MAX_MS, value: latencyBudget, onChange: (event) => save({ latencyBudgetMs: Number(event.target.value) }), style: { ...controlStyle, width: 96 }, 'aria-label': t('setBudget') }), 'budget'),
          row(t('setMaxChars'), t('setMaxCharsTip'), h('input', { type: 'number', min: CHARS_MIN, max: CHARS_MAX, value: maxChars, onChange: (event) => save({ maxSuggestionChars: Number(event.target.value) }), style: { ...controlStyle, width: 96 }, 'aria-label': t('setMaxChars') }), 'chars'),
          row(t('setRetention'), t('setRetentionTip'), h('input', { type: 'number', min: 0, max: 365, value: settings.retentionDays, onChange: (event) => save({ retentionDays: Math.max(0, Math.min(365, Math.floor(Number(event.target.value) || 0))) }), style: { ...controlStyle, width: 96 }, 'aria-label': t('setRetention') }), 'retention'),
          row(t('setHeader'), t('setHeaderTip'), h('input', { type: 'checkbox', checked: settings.showHeader, onChange: (event) => save({ showHeader: event.target.checked }), 'aria-label': t('setHeader') }), 'header'),
          row(t('setConfirmSend'), t('setConfirmSendTip'), h('input', { type: 'checkbox', checked: settings.confirmBeforeSend === true, onChange: (event) => save({ confirmBeforeSend: event.target.checked }), 'aria-label': t('setConfirmSend') }), 'confirmsend'),
          row(t('metrics'), t('metrics'), metricTable, 'metrics'),
          row(t('favorites'), favoriteEntries.length === 0 ? t('favoritesEmpty') : '', h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, favoriteEntries.length === 0 ? null : h('button', { type: 'button', className: 'dsh-sf-action', onClick: exportFavorites }, t('favoritesExport')), favoriteEntries.length === 0 ? null : h('button', { type: 'button', className: 'dsh-sf-action', onClick: exportFavoritesJson }, t('favoritesExportJson')), favoriteEntries.length === 0 ? null : h('input', { type: 'text', value: favQuery, onChange: (event) => setFavQuery(event.target.value), placeholder: t('favoritesSearch'), 'aria-label': t('favoritesSearch'), style: controlStyle }), favoriteEntries.length === 0 ? null : h('input', { type: 'file', accept: 'application/json,.json', onChange: (event) => importFavorites(event), style: { ...controlStyle, maxWidth: 240 } }), favoriteEntries.length === 0 ? null : h('span', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('input', { type: 'checkbox', 'aria-label': t('favoriteSelectAll'), checked: allVisibleSelected, onChange: toggleAllVisibleFavorites }),
            h('button', { type: 'button', className: 'dsh-sf-action', disabled: selectedFavs.size === 0, onClick: copySelectedFavorites }, t('favoriteCopySelected').replace('{n}', String(selectedFavs.size))),
            h('button', { type: 'button', className: 'dsh-sf-action', disabled: selectedFavs.size === 0, onClick: removeSelectedFavorites }, bulkRemoveArmed ? t('favoriteRemoveConfirm').replace('{n}', String(selectedFavs.size)) : t('favoriteRemoveSelected').replace('{n}', String(selectedFavs.size)))), favoriteList), 'favorites'),
          row(t('discarded'), discardedEntries.length === 0 ? t('discardedEmpty') : '', discardedList, 'discarded'),
          row(t('audit'), audit.length === 0 ? t('auditEmpty') : '', h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            audit.length === 0 ? null : h('button', { type: 'button', className: 'dsh-sf-action', onClick: clearAudit }, t('auditClear')),
            audit.length === 0 ? null : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 420 } }, audit.slice().reverse().slice(0, 20).map((entry, index) => h('div', { key: entry.at + '-' + index, style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, new Date(entry.at).toLocaleString() + ' · ' + (entry.kind === 'sent' ? t('auditKindSent') : t('auditKindGenerated')) + ' · #' + String(entry.hash).slice(0, 8))))), 'audit'),
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '14px 0', borderBottom: '.5px solid var(--dsw-alias-border-l1)', flexWrap: 'wrap' } },
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, t('update')),
              h('div', { style: { fontSize: 12, color: pendingIsNewer || updateState.installing ? 'var(--dsw-alias-state-success-primary, #22c55e)' : u !== null && u.newer ? 'var(--dsw-alias-state-success-primary, #22c55e)' : 'var(--dsw-alias-label-tertiary)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'center' } },
                h('span', null, t('current') + ': ' + (runningVersion || pendingVersion || '—')),
                h('span', null, updateState.checking ? t('checking') : updateStatus))),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' } },
              u !== null && u.newer && !pendingIsNewer ? h('button', { onClick: installUpdate, disabled: updateState.installing, style: { ...linkStyle, fontWeight: 600, opacity: updateState.installing ? 0.6 : 1, cursor: updateState.installing ? 'wait' : 'pointer' } }, t('updateNow')) : null,
              h('button', { onClick: checkUpdate, style: linkStyle }, t('check')),
              u !== null && typeof u.url === 'string' && u.url !== '' ? h('a', { href: u.url, target: '_blank', rel: 'noreferrer', style: linkStyle, title: t('open') }, t('open')) : null)),
          updateState.installError !== '' ? h('div', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, padding: '8px 0' } }, updateState.installError === 'local-development' ? t('localDev') : updateState.installError === 'unsupported-version' ? t('unsupportedVersion') : updateState.installError === 'precheck' ? t('updatePrecheck') : updateState.installError === 'no-installer' ? t('updateNoManager') : t('installError') + ' (' + updateState.installError + ')') : null,
          pendingIsNewer || heldBack ? h('div', { style: { color: 'var(--dsw-alias-state-success-primary, #22c55e)', fontSize: 12, padding: '8px 0' } }, pendingMsg) : null,
          h('div', { style: { display: 'flex', gap: 8, padding: '14px 0', flexWrap: 'wrap' } },
            h('a', { href: 'https://github.com/klaus-2/dsh-nextsteps', target: '_blank', rel: 'noreferrer', style: linkStyle }, t('repo')),
            h('a', { href: 'https://github.com/klaus-2/dsh-nextsteps/issues', target: '_blank', rel: 'noreferrer', style: linkStyle }, t('issues'))),
          h('div', { className: 'dsh-sf-notice', style: { paddingBottom: 8 } }, localNotice));
      };
    }

    return {
      inject: ['slots', 'locale', 'remote'],
      apply(ctx) {
        const injectScope = (deps, setup) => {
          if (ctx.inject === undefined) return [];
          const fiber = ctx.inject(deps, setup);
          return [() => fiber.dispose()];
        };
        for (const off of injectScope(['remote.pluginManager'], (scope) => {
          updateManager = scope.remote?.pluginManager;
          scope.effect(() => () => { updateManager = undefined; }, 'dsh-nextsteps: update installer');
        })) if (ctx.effect !== undefined) ctx.effect(() => off, 'dsh-nextsteps: update installer scope');
        installStyles(ctx);
        readIndex();
        migrateLegacyCaptures();
        refreshPluginSettings().then(() => {
          const index = readIndex();
          const touched = pruneExpiredCaptures(index, pluginSettings.retentionDays);
          if (touched.size > 0) persistCaptures('', index, touched);
        });
        for (const [code, dictionary] of Object.entries(DICTIONARIES)) {
          ctx.effect(() => {
            try {
              return ctx.locale.register(NS, code, dictionary);
            } catch (error) {
              console.warn('dsh-nextsteps: ' + code + ' dictionary was not accepted by the locale service:', error);
              return undefined;
            }
          }, 'dsh-nextsteps: ' + code + ' dictionary');
        }

        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: TOOL_NAME
        }, createCapture()));

        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'dsh-nextsteps',
          locale: NS
        }, createTail(ctx)));

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-nextsteps',
          order: 94,
          label: () => 'Nextsteps',
          locale: NS
        }, createSettings(ctx)));
      },
      flushWrites
    };
  }
});
