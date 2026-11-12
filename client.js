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
    const UPDATE_KEY = 'dsh-nextsteps.updated';
    const CAPTURES_INDEX_KEY = 'dsh-nextsteps.captures.index';
    const CAPTURE_SESSION_KEY = 'dsh-nextsteps.captures.session';
    const FAVORITES_KEY = 'dsh-nextsteps.favorites';
    const DISCARDED_KEY = 'dsh-nextsteps.discarded';
    const METRICS_KEY = 'dsh-nextsteps.metrics';
    const CAPTURES_KEY = 'dsh-nextsteps.captures.v1';
    const remembered = () => { try { return localStorage.getItem(UPDATE_KEY); } catch { return null; } };

    const CSS = `
.dsh-sf-root { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.dsh-sf-header { font-size: 11px; letter-spacing: 0.02em; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsh-sf-header-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-sf-row { display: flex; flex-wrap: wrap; gap: 8px; }
.dsh-sf-item { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; max-width: 100%; }
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
      const index = readIndex();
      let migrated = true;
      for (const [sessionId, sessionEntries] of Object.entries(store)) {
        if (sessionEntries === null || typeof sessionEntries !== 'object' || Array.isArray(sessionEntries)) continue;
        const entries = {};
        for (const [callId, entry] of Object.entries(sessionEntries)) {
          if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.followups) || entry.followups.length === 0) continue;
          entries[callId] = { turn: entry.turn === undefined ? undefined : turnIdOf(entry.turn), followups: entry.followups, clickedId: entry.clickedId };
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
          entries.set(callId, { turn: entry.turn === undefined ? undefined : turnIdOf(entry.turn), followups: entry.followups, clickedId: entry.clickedId });
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

    function rememberCapture(sessionId, callId, turn, followups) {
      if (followups === null || followups === undefined) return;
      const started = Date.now();
      const entries = capturesFor(sessionId);
      const previous = entries.get(callId);
      const mergedTurn = turnIdOf(turn) ?? previous?.turn;
      const clickedId = previous?.clickedId
        ?? `sf-${contentHash(`${sessionId}|${mergedTurn ?? callId}|${callId}|${followups.map((entry) => entry.prompt).join('|')}`)}`;
      entries.set(callId, { turn: mergedTurn, followups, clickedId });
      const index = readIndex();
      const calls = registerSession(index, sessionId);
      calls[callId] = mergedTurn ?? null;
      const touched = pruneCaptures(index);
      persistCaptures(sessionId, index, touched);
      recordMetric('persistence', Date.now() - started);
      for (const listener of captureListeners) listener(sessionId);
    }

    function capturesForTurn(sessionId, turn) {
      const entries = capturesFor(sessionId);
      const host = hostMode(pluginSettings);
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

    function readFavorites() {
      const parsed = readJson(FAVORITES_KEY, null);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
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

    function contentHash(text) {
      let hash = 5381;
      for (let index = 0; index < text.length; index++) {
        hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
      }
      return (hash >>> 0).toString(36);
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
              console.warn('dsh-nextsteps: composer submit failed:', error);
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

    function FollowupsCard({ entries, sessionId, ctx, t, header, footer, deferred, rootRef }) {
      const [sentLocally, setSentLocally] = React.useState(() => new Set());
      const [failure, setFailure] = React.useState(null);
      const [notice, setNotice] = React.useState('');
      const [itemState, setItemState] = React.useState(() => ({}));
      const [localStores, setLocalStores] = React.useState(() => ({ favorites: readFavorites(), discarded: readDiscarded() }));
      const busyRef = React.useRef(null);
      const clicked = readClickedMap();
      const favorites = localStores.favorites;
      const discarded = localStores.discarded;
      const items = Array.isArray(entries) ? entries : [];

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
          setFailure(errorMessage(error));
          busyRef.current = null;
          return;
        }
        Promise.resolve()
          .then(() => sendFollowup(text))
          .then(() => {
            markClicked(itemId);
            setSentLocally((previous) => new Set(previous).add(itemId));
            setFailure(null);
            setNotice(announcement);
          })
          .catch((error) => {
            console.warn('dsh-nextsteps: send failed:', error);
            setFailure(errorMessage(error));
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
        scheduleWrite(FAVORITES_KEY, JSON.stringify(store));
        refreshLocalStores(store, undefined);
        setNotice(t('srFavorited'));
      };

      const discard = (captureKey, prompt, label, turn) => {
        const store = readDiscarded();
        store[captureKey] = { prompt, label, at: Date.now(), sessionId, turn };
        scheduleWrite(DISCARDED_KEY, JSON.stringify(store));
        refreshLocalStores(undefined, store);
        setNotice(t('srDiscarded'));
      };

      const sessionDiscards = Object.entries(discarded)
        .filter(([, value]) => value !== null && typeof value === 'object' && value.sessionId === sessionId);
      sessionDiscards.sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0));
      const recentDiscard = sessionDiscards.length === 0 ? undefined : sessionDiscards[0];

      const undoDiscard = (captureKey) => {
        const store = readDiscarded();
        if (store[captureKey] === undefined) return;
        delete store[captureKey];
        scheduleWrite(DISCARDED_KEY, JSON.stringify(store));
        refreshLocalStores(undefined, store);
        setNotice(t('srRestored'));
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

      const rows = [];
      const buildStarted = Date.now();
      for (const entry of items) {
        const followups = Array.isArray(entry?.followups) ? entry.followups : [];
        for (const [index, followup] of followups.entries()) {
          const itemId = `${entry.clickedId}:${index}`;
          if (discarded[itemId] !== undefined) continue;
          const label = displayLabel(followup);
          const prompt = followup.prompt;
          const state = itemState[itemId] ?? {};
          const sent = sentLocally.has(itemId) || clicked[itemId] === true;
          const canExpand = prompt !== label;
          const favId = contentHash(prompt);
          const fav = favorites[favId] !== undefined;
          rows.push(h('div', {
            key: itemId,
            className: 'dsh-sf-item',
            role: 'group',
            'aria-label': prompt,
            onKeyDown: (event) => onItemKey(event, itemId, prompt, label, entry)
          },
            h('button', {
              type: 'button',
              className: 'dsh-sf-card' + (sent ? ' is-sent' : ''),
              disabled: sent,
              title: prompt,
              'aria-label': prompt,
              onClick: () => {
                if (sent) return;
                send(prompt, itemId, t('srFollowupSent'));
              }
            },
              h('span', { className: 'dsh-sf-icon', 'aria-hidden': true }, sent ? '✓' : '→'),
              h('span', { className: 'dsh-sf-label' }, label),
              sent ? h('span', { className: 'dsh-sf-sr' }, t('srFollowupSent')) : null),
            state.expanded === true ? h('div', { className: 'dsh-sf-prompt' }, prompt) : null,
            state.editing === true ? h('div', { className: 'dsh-sf-editor' },
              h('textarea', {
                className: 'dsh-sf-textarea',
                'aria-label': t('editPrompt'),
                value: state.draft ?? prompt,
                onChange: (event) => updateItem(itemId, { draft: event.target.value })
              }),
              h('span', { className: 'dsh-sf-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsh-sf-action',
                  onClick: () => {
                    const draft = (state.draft ?? prompt).trim();
                    if (draft === '') return;
                    send(draft, itemId, t('srEdited'));
                    updateItem(itemId, { editing: false, draft: '' });
                  }
                }, t('editConfirm')),
                h('button', {
                  type: 'button',
                  className: 'dsh-sf-action',
                  onClick: () => updateItem(itemId, { editing: false, draft: '' })
                }, t('editCancel')))) : null,
            h('span', { className: 'dsh-sf-actions' },
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
                'aria-label': t('actionDiscard'),
                title: `${t('actionDiscard')} (D)`,
                'aria-keyshortcuts': 'd',
                onClick: () => discard(itemId, prompt, label, entry.turn)
              }, '✕'),
              canExpand ? h('button', {
                type: 'button',
                className: 'dsh-sf-action',
                'aria-label': state.expanded === true ? t('actionCollapse') : t('actionExpand'),
                onClick: () => updateItem(itemId, { expanded: state.expanded !== true })
              }, state.expanded === true ? '⌃' : '…') : null),
            h('span', { className: 'dsh-sf-hints' },
              `${t('actionCopy')} C · ${t('actionFavorite')} F · ${t('actionEdit')} E · ${t('actionDiscard')} D`)));
        }
      }

      recordMetric('rendering', Date.now() - buildStarted);

      return h('div', { className: 'dsh-sf-root', ref: rootRef },
        header ?? null,
        deferred === true
          ? h('div', { className: 'dsh-sf-placeholder' }, '…')
          : h('div', { className: 'dsh-sf-row' }, rows),
        failure === null ? null : h('div', { className: 'dsh-sf-error' }, `${t('sendFailed')}${failure}`),
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
        footer ?? null);
    }

    const generationState = new Map();
    const generationAfterSeq = new Map();
    const warnedTurns = new Set();
    let settingsRevision = 0;

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
      console.warn('dsh-nextsteps: generation failed:', error);
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
      const state = { controller: null, attempts: 0, cancelled: false };
      generationState.set(key, state);
      for (const listener of captureListeners) listener(sessionId);
      const revision = settingsRevision;
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
              body: JSON.stringify({ sessionId, afterSeq }),
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
              failure = new Error(`the generator answered with HTTP ${response.status}`);
              retryable = response.status >= 500;
            } else {
              const followups = validateFollowups(Array.isArray(data?.followups) ? data.followups : null);
              if (followups === null) {
                failure = new Error('the generator answered without suggestions');
                retryable = true;
              } else {
                if (revision !== settingsRevision) return;
                rememberCapture(sessionId, 'generated-' + turn, turn, followups);
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
        const rootRef = React.useRef(null);
        const host = hostMode(pluginSettings);

        React.useEffect(() => {
          captureListeners.add(refresh);
          return () => {
            captureListeners.delete(refresh);
          };
        }, []);

        React.useEffect(() => {
          const supported = typeof IntersectionObserver === 'function';
          setVisible(!supported);
          if (!supported) return undefined;
          const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
          }, { rootMargin: '200px' });
          const node = rootRef.current;
          if (node !== null && node !== undefined && typeof observer.observe === 'function') observer.observe(node);
          return () => {
            if (typeof observer.disconnect === 'function') observer.disconnect();
          };
        }, [sessionId, turn]);

        React.useEffect(() => {
          if (sessionId === '' || turn === undefined) return undefined;
          generationAfterSeq.set(generationKey(sessionId, turn), afterSeq);
          if (!hostMode(pluginSettings)) return undefined;
          if (pluginSettings.generationMode === 'on-demand') return undefined;
          if (afterSeq === undefined) return undefined;
          if (capturesForTurn(sessionId, turn).length > 0) return undefined;
          startGeneration(sessionId, turn, afterSeq);
          return () => {
            cancelGeneration(sessionId, turn);
          };
        }, [sessionId, turn, afterSeq, host]);

        React.useEffect(() => {
          if (sessionId === '' || turn === undefined) return undefined;
          return () => {
            cancelGeneration(sessionId, turn);
          };
        }, [sessionId, turn]);

        let entries = turn !== undefined ? capturesForTurn(sessionId, turn) : [];
        if (entries.length === 0 && turn === undefined && !hostMode(pluginSettings)) {
          const newest = newestCapture(sessionId);
          if (newest !== null) entries = [newest];
        }
        if (entries.length === 0 && !hostMode(pluginSettings)) {
          const unclaimed = unclaimedCaptures(sessionId, turn);
          if (unclaimed !== null) entries = [unclaimed];
        }

        const key = turn === undefined ? '' : generationKey(sessionId, turn);
        const generating = key !== '' && generationState.has(key);
        const onDemand = pluginSettings.generationMode === 'on-demand';

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
              }, t('manualCancel')))) : null);

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
          footer,
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
    const NPM_NAME = 'dsh-nextsteps';
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
    const UPDATE_ROUTE = '/api/dsh-nextsteps.update';
    const DICTIONARIES = {
      en: {"header":"Suggested followups","srFollowupSent":"Followup sent","sendFailed":"Could not send: ","intro":"Suggested next-step prompts under every finished agent turn — one click sends the followup.","setLanguage":"Language","setLanguageTip":"Followups are generated in this language. Auto follows the conversation; an explicit language uses a separate call.","optAuto":"Auto (follow the conversation)","setModel":"Model","setModelTip":"The model that generates the suggestions. Auto uses the chat's model inside the turn; an explicit language or model uses a separate call.","optModelAuto":"Auto (same model as the chat)","modelUnavailable":"No model list available in this install","setMax":"Followups per turn","setMaxTip":"How many suggested prompts the model should produce (1-6).","setHeader":"Show header","setHeaderTip":"The small “Suggested followups” label above the cards.","updates":"Updates","current":"Version","checking":"Checking…","upToDate":"up to date","available":"{v} is available","manualCopy":"Development or renamed copy — update it manually.","installing":"Installing {v}…","restartMsg":"Version {v} was installed. Restart the dsh to use it.","noReleases":"No releases published yet","checkFailed":"Update check failed ({e})","updateNow":"Update now","check":"Check for updates","openRelease":"Open release page","repo":"GitHub repository","issues":"Report an issue","setStyles":"Suggestion styles","setStylesTip":"The angles the suggestions should cover. The generator varies the prompts across the selected styles. At least one style stays selected.","styleNextAction":"Next action","styleExplore":"Explore","styleDeepDive":"Deep dive","setGenMode":"Generation","setGenModeTip":"Auto suggests the followups when the turn ends; on demand waits for your button.","optGenAuto":"Auto (when the turn ends)","optGenOnDemand":"On demand (button)","setBudget":"Latency budget","setBudgetTip":"How long the generator may run before the request is given up (5000-120000 ms).","setMaxChars":"Suggestion length","setMaxCharsTip":"The maximum number of characters of one suggestion (60-600).","metrics":"Performance","metricGeneration":"Generation","metricPersistence":"Persistence","metricRendering":"Rendering","metricAvg":"Average","metricMax":"Maximum","metricNoData":"No data yet","favorites":"Favourites","favoritesEmpty":"No favourite suggestion yet.","favoriteCopy":"Copy","favoriteRemove":"Remove","discarded":"Discarded","discardedEmpty":"No discarded suggestion.","discardRestore":"Restore","actionCopy":"Copy","actionDiscard":"Discard","actionFavorite":"Favourite","actionEdit":"Edit","actionExpand":"Show the full prompt","actionCollapse":"Hide the full prompt","copied":"Copied","copyFailed":"The suggestion could not be copied.","editConfirm":"Send","editCancel":"Cancel","editPrompt":"The suggestion text","addSuggestion":"Add suggestion","manualPlaceholder":"Write your own suggestion","manualSave":"Save","manualCancel":"Cancel","generateNow":"Generate suggestions","generating":"Generating…","undoDiscard":"Undo discard","srCopied":"The suggestion was copied to the clipboard.","srDiscarded":"The suggestion was discarded. Use Undo to bring it back.","srFavorited":"The suggestion was saved as a favourite.","srEdited":"The edited suggestion was sent.","srRestored":"The discarded suggestion was restored."},
      'pt-BR': {"header":"Sugestões de acompanhamento","srFollowupSent":"Follow-up enviado","sendFailed":"Não consegui enviar: ","intro":"Sugestões de próximos passos sob cada turno concluído do agente — um clique envia o followup.","setLanguage":"Idioma","setLanguageTip":"Os followups são gerados neste idioma. Automático segue a conversa; um idioma explícito usa uma chamada separada.","optAuto":"Automático (segue a conversa)","setModel":"Modelo","setModelTip":"O modelo que gera as sugestões. Automático usa o modelo da conversa dentro do turno; um idioma ou modelo explícito usa uma chamada separada.","optModelAuto":"Automático (mesmo modelo da conversa)","modelUnavailable":"Nenhuma lista de modelos disponível nesta instalação","setMax":"Followups por turno","setMaxTip":"Quantas sugestões o modelo deve produzir (1-6).","setHeader":"Mostrar cabeçalho","setHeaderTip":"O rótulo pequeno “Sugestões de acompanhamento” acima dos cartões.","updates":"Atualizações","current":"Versão","checking":"Verificando…","upToDate":"em dia","available":"{v} disponível","manualCopy":"Cópia de desenvolvimento ou renomeada — atualize manualmente.","installing":"Instalando {v}…","restartMsg":"Versão {v} instalada. Reinicie o dsh para usá-la.","noReleases":"Nenhum release publicado ainda","checkFailed":"Falha ao verificar atualizações ({e})","updateNow":"Atualizar agora","check":"Verificar atualizações","openRelease":"Abrir página do release","repo":"Repositório no GitHub","issues":"Reportar um problema","setStyles":"Estilos de sugestão","setStylesTip":"Os ângulos que as sugestões devem cobrir. O gerador varia os prompts entre os estilos selecionados. Pelo menos um estilo permanece selecionado.","styleNextAction":"Próxima ação","styleExplore":"Explorar","styleDeepDive":"Aprofundar","setGenMode":"Geração","setGenModeTip":"Automático sugere os followups quando o turno termina; sob demanda espera pelo seu botão.","optGenAuto":"Automático (ao fim do turno)","optGenOnDemand":"Sob demanda (botão)","setBudget":"Orçamento de latência","setBudgetTip":"Quanto tempo o gerador pode rodar antes de a requisição ser abandonada (5000-120000 ms).","setMaxChars":"Tamanho da sugestão","setMaxCharsTip":"O número máximo de caracteres de uma sugestão (60-600).","metrics":"Desempenho","metricGeneration":"Geração","metricPersistence":"Persistência","metricRendering":"Renderização","metricAvg":"Média","metricMax":"Máximo","metricNoData":"Sem dados ainda","favorites":"Favoritos","favoritesEmpty":"Nenhuma sugestão favorita ainda.","favoriteCopy":"Copiar","favoriteRemove":"Remover","discarded":"Descartadas","discardedEmpty":"Nenhuma sugestão descartada.","discardRestore":"Restaurar","actionCopy":"Copiar","actionDiscard":"Descartar","actionFavorite":"Favoritar","actionEdit":"Editar","actionExpand":"Mostrar o prompt completo","actionCollapse":"Ocultar o prompt completo","copied":"Copiado","copyFailed":"Não foi possível copiar a sugestão.","editConfirm":"Enviar","editCancel":"Cancelar","editPrompt":"O texto da sugestão","addSuggestion":"Adicionar sugestão","manualPlaceholder":"Escreva sua própria sugestão","manualSave":"Salvar","manualCancel":"Cancelar","generateNow":"Gerar sugestões","generating":"Gerando…","undoDiscard":"Desfazer descarte","srCopied":"A sugestão foi copiada para a área de transferência.","srDiscarded":"A sugestão foi descartada. Use Desfazer para trazê-la de volta.","srFavorited":"A sugestão foi salva como favorita.","srEdited":"A sugestão editada foi enviada.","srRestored":"A sugestão descartada foi restaurada."},
      'zh-CN': {"header":"建议的后续操作","srFollowupSent":"后续操作已发送","sendFailed":"发送失败：","intro":"在每个智能体回合完成后的下方推荐下一步提示——单击即可发送。","setLanguage":"语言","setLanguageTip":"后续操作提示将以此语言生成。“自动”跟随对话语言;指定语言时使用单独调用。","optAuto":"自动（跟随对话）","setModel":"模型","setModelTip":"生成建议的模型。“自动”在回合内使用对话所用的模型;指定语言或模型时使用单独调用。","optModelAuto":"自动（与对话相同的模型）","modelUnavailable":"此安装没有可用的模型列表","setMax":"每回合提示数","setMaxTip":"模型应生成的建议提示数量（1-6）。","setHeader":"显示标题","setHeaderTip":"卡片上方的小标题“建议的后续操作”。","updates":"更新","current":"版本","checking":"检查中…","upToDate":"已是最新","available":"{v} 可用","manualCopy":"开发或重命名的副本——请手动更新。","installing":"正在安装 {v}…","restartMsg":"版本 {v} 已安装。请重启 dsh 以使用。","noReleases":"尚未发布任何版本","checkFailed":"检查更新失败（{e}）","updateNow":"立即更新","check":"检查更新","openRelease":"打开发布页","repo":"GitHub 仓库","issues":"反馈问题","setStyles":"建议风格","setStylesTip":"建议应覆盖的角度。生成器会在所选风格之间变换提示。至少保留一种风格。","styleNextAction":"下一步行动","styleExplore":"探索","styleDeepDive":"深入","setGenMode":"生成方式","setGenModeTip":"自动会在回合结束时给出后续操作；按需则等待你点击按钮。","optGenAuto":"自动（回合结束时）","optGenOnDemand":"按需（按钮）","setBudget":"延迟预算","setBudgetTip":"生成器最多可以运行多久才会放弃请求（5000-120000 毫秒）。","setMaxChars":"建议长度","setMaxCharsTip":"一条建议的最大字符数（60-600）。","metrics":"性能","metricGeneration":"生成","metricPersistence":"持久化","metricRendering":"渲染","metricAvg":"平均","metricMax":"最大","metricNoData":"暂无数据","favorites":"收藏","favoritesEmpty":"还没有收藏的建议。","favoriteCopy":"复制","favoriteRemove":"移除","discarded":"已丢弃","discardedEmpty":"没有已丢弃的建议。","discardRestore":"恢复","actionCopy":"复制","actionDiscard":"丢弃","actionFavorite":"收藏","actionEdit":"编辑","actionExpand":"显示完整提示","actionCollapse":"隐藏完整提示","copied":"已复制","copyFailed":"无法复制这条建议。","editConfirm":"发送","editCancel":"取消","editPrompt":"建议文本","addSuggestion":"添加建议","manualPlaceholder":"写下你自己的建议","manualSave":"保存","manualCancel":"取消","generateNow":"生成建议","generating":"正在生成…","undoDiscard":"撤销丢弃","srCopied":"建议已复制到剪贴板。","srDiscarded":"建议已被丢弃。使用“撤销丢弃”可以恢复。","srFavorited":"建议已加入收藏。","srEdited":"编辑后的建议已发送。","srRestored":"已丢弃的建议已恢复。"}
    };
    const DEFAULT_SETTINGS = {
      lang: 'auto',
      maxFollowups: 3,
      showHeader: true,
      model: '',
      styles: [...STYLE_IDS],
      generationMode: 'auto',
      latencyBudgetMs: LATENCY_DEFAULT_MS,
      maxSuggestionChars: CHARS_DEFAULT
    };
    let pluginSettings = { ...DEFAULT_SETTINGS };
    let updateManager = undefined;

    let pluginVersion;

    const hostMode = (settings) => !(settings.lang === 'auto' && (typeof settings.model !== 'string' || settings.model === ''));

    function settingsSignature(settings) {
      return JSON.stringify([
        settings.lang,
        settings.model,
        settings.maxFollowups,
        settings.showHeader,
        settings.styles,
        settings.generationMode,
        settings.latencyBudgetMs,
        settings.maxSuggestionChars
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
          if (typeof data.version === 'string') pluginVersion = data.version;
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
        const [update, setUpdate] = React.useState({ status: 'idle' });
        const [local, setLocal] = React.useState(() => ({ favorites: readFavorites(), discarded: readDiscarded() }));
        const [localNotice, setLocalNotice] = React.useState('');
        React.useEffect(() => {
          refreshPluginSettings().then((loaded) => setSettings({ ...loaded }));
          check();
        }, []);
        const [models, setModels] = React.useState(() => modelCatalogCache);
        React.useEffect(() => {
          let alive = true;
          loadModelCatalog(true).then((catalog) => { if (alive) setModels(catalog); });
          return () => { alive = false; };
        }, []);
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
        const check = async () => {
          setUpdate((previous) => ({ ...previous, status: 'checking' }));
          try {
            const response = await fetch(UPDATE_ROUTE, { cache: 'no-store' });
            const info = await responseJson(response);
            if (!response.ok || info === null || typeof info !== 'object' || info.error !== undefined) throw new Error(info?.error ?? 'HTTP ' + response.status);
            const status = info.newer !== true ? 'current' : remembered() === info.latest ? 'restart' : info.managed ? 'available' : 'manual';
            setUpdate({ status, info });
          } catch (error) {
            setUpdate((previous) => previous.status === 'restart' ? previous : { status: 'error', info: previous.info, error: String(error?.message ?? error) });
          }
        };
        const install = async () => {
          const { info } = update;
          if (info === undefined || updateManager === undefined) {
            setUpdate({ status: 'error', info, error: 'the plugin manager is not available in this install' });
            return;
          }
          setUpdate({ status: 'installing', info });
          try {
            const requestId = NS + '-update-' + info.latest + '-' + Date.now();
            const installSpec = async (spec) => {
              const reply = await updateManager.installBundle(spec, { requestId });
              if (!reply?.ok) throw new Error(reply?.error?.message ?? 'plugin manager did not answer');
              return reply.value;
            };
            let result = await installSpec(NPM_NAME + '@' + info.latest);
            if (result?.error?.code === 'already-installed') result = await installSpec('https://registry.npmjs.org/' + NPM_NAME + '/-/' + NPM_NAME + '-' + info.latest + '.tgz');
            const diagnosticLines = String(result?.error?.diagnostic ?? '').split(String.fromCharCode(10)).map((line) => line.trim()).filter((line) => line !== '');
            const firstLine = () => diagnosticLines.find((line) => line.startsWith('dsh:')) ?? diagnosticLines.at(-1) ?? result?.error?.code ?? result?.application;
            const live = result?.application === 'applied';
            if (!live && result?.application !== 'restart-required' && result?.version !== info.latest) throw new Error(firstLine());
            if (result?.application === 'failed') console.warn(`dsh-nextsteps: ${info.latest} is installed; dsh could not start it before a restart: ${firstLine()}`);
            try { localStorage.setItem(UPDATE_KEY, info.latest); } catch { }
            setUpdate(live
              ? { status: 'current', info: { ...info, current: info.latest, newer: false } }
              : { status: 'restart', info });
          } catch (error) {
            setUpdate({ status: 'error', info, error: String(error?.message ?? error) });
          }
        };
        const info = update.info ?? {};
        const successColor = 'var(--dsw-alias-state-success-primary, #22c55e)';
        let statusText;
        let statusColor = 'var(--dsw-alias-label-tertiary)';
        if (update.status === 'checking') statusText = t('checking');
        else if (update.status === 'restart') { statusText = t('restartMsg').replace('{v}', info.latest ?? ''); statusColor = successColor; }
        else if (update.status === 'installing') statusText = t('installing').replace('{v}', info.latest ?? '');
        else if (update.status === 'available') { statusText = t('available').replace('{v}', info.latest ?? ''); statusColor = successColor; }
        else if (update.status === 'manual') statusText = t('manualCopy');
        else if (update.status === 'current') statusText = t('upToDate');
        else if (update.status === 'error') statusText = t('checkFailed').replace('{e}', update.error ?? '?');
        else statusText = t('noReleases');
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
        const favoriteList = favoriteEntries.length === 0
          ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('favoritesEmpty'))
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 420 } }, favoriteEntries.map(([favId, value]) => h('div', { key: favId, style: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' } },
            h('span', { style: { fontSize: 12 } }, typeof value?.prompt === 'string' ? value.prompt : String(value?.label ?? '')),
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
                onClick: () => {
                  const store = readFavorites();
                  delete store[favId];
                  scheduleWrite(FAVORITES_KEY, JSON.stringify(store));
                  refreshLocal();
                }
              }, t('favoriteRemove'))))));
        const discardedList = discardedEntries.length === 0
          ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('discardedEmpty'))
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 420 } }, discardedEntries.map(([captureKey, value]) => h('div', { key: captureKey, style: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' } },
            h('span', { style: { fontSize: 12 } }, typeof value?.prompt === 'string' ? value.prompt : String(value?.label ?? '')),
            h('button', {
              type: 'button',
              className: 'dsh-sf-action',
              onClick: () => {
                const store = readDiscarded();
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
          row(t('setModel'), t('setModelTip'), models === undefined ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('checking')) : (models.groups ?? []).length === 0 ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('modelUnavailable')) : h('select', { value: settings.model, onChange: (event) => save({ model: event.target.value }), style: controlStyle, 'aria-label': t('setModel') },
            h('option', { value: '' }, t('optModelAuto')),
            ...(models.groups ?? []).map((group) => h('optgroup', { key: group.id, label: group.name },
              group.models.map((entry) => h('option', { key: group.id + '/' + entry.id, value: group.id + '/' + entry.id }, entry.name === entry.id ? entry.name : entry.name + ' (' + entry.id + ')'))))), 'model'),
          row(t('setMax'), t('setMaxTip'), h('input', { type: 'number', min: 1, max: 6, value: settings.maxFollowups, onChange: (event) => save({ maxFollowups: Number(event.target.value) }), style: { ...controlStyle, width: 64 }, 'aria-label': t('setMax') }), 'max'),
          row(t('setStyles'), t('setStylesTip'), h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } }, styleRows.map((entry) => h('label', { key: entry.id, style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 } },
            h('input', { type: 'checkbox', checked: selectedStyles.includes(entry.id), onChange: (event) => toggleStyle(entry.id, event.target.checked), 'aria-label': entry.label }),
            entry.label))), 'styles'),
          row(t('setGenMode'), t('setGenModeTip'), h('select', { value: generationMode, onChange: (event) => save({ generationMode: event.target.value }), style: controlStyle, 'aria-label': t('setGenMode') },
            h('option', { value: 'auto' }, t('optGenAuto')),
            h('option', { value: 'on-demand' }, t('optGenOnDemand'))), 'genmode'),
          row(t('setBudget'), t('setBudgetTip'), h('input', { type: 'number', min: LATENCY_MIN_MS, max: LATENCY_MAX_MS, value: latencyBudget, onChange: (event) => save({ latencyBudgetMs: Number(event.target.value) }), style: { ...controlStyle, width: 96 }, 'aria-label': t('setBudget') }), 'budget'),
          row(t('setMaxChars'), t('setMaxCharsTip'), h('input', { type: 'number', min: CHARS_MIN, max: CHARS_MAX, value: maxChars, onChange: (event) => save({ maxSuggestionChars: Number(event.target.value) }), style: { ...controlStyle, width: 96 }, 'aria-label': t('setMaxChars') }), 'chars'),
          row(t('setHeader'), t('setHeaderTip'), h('input', { type: 'checkbox', checked: settings.showHeader, onChange: (event) => save({ showHeader: event.target.checked }), 'aria-label': t('setHeader') }), 'header'),
          row(t('metrics'), t('metrics'), metricTable, 'metrics'),
          row(t('favorites'), favoriteEntries.length === 0 ? t('favoritesEmpty') : '', favoriteList, 'favorites'),
          row(t('discarded'), discardedEntries.length === 0 ? t('discardedEmpty') : '', discardedList, 'discarded'),
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '14px 0', borderBottom: '.5px solid var(--dsw-alias-border-l1)', flexWrap: 'wrap' } },
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, t('updates')),
              h('div', { style: { fontSize: 12, color: statusColor, marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'center' } },
                h('span', null, t('current') + ': ' + (info.current ?? pluginVersion ?? '?')),
                h('span', null, statusText))),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' } },
              update.status === 'available' ? h('button', { onClick: install, style: { ...linkStyle, fontWeight: 600 } }, t('updateNow')) : null,
              h('button', { onClick: check, style: linkStyle }, t('check')),
              typeof info.url === 'string' ? h('a', { href: info.url, target: '_blank', rel: 'noreferrer', style: linkStyle }, t('openRelease')) : null)),
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
        refreshPluginSettings();
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
