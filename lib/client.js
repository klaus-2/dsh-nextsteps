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
    const CLICKED_KEY = 'dsh.suggest-followups.clicked';

    const en = {
      header: 'Suggested followups',
      srFollowupSent: 'Followup sent',
      sendFailed: 'Could not send: '
    };

    const ptBR = {
      header: 'Sugestões de acompanhamento',
      srFollowupSent: 'Follow-up enviado',
      sendFailed: 'Não consegui enviar: '
    };

    const CSS = `
.dsh-sf-root { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.dsh-sf-header { font-size: 11px; letter-spacing: 0.02em; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsh-sf-row { display: flex; flex-wrap: wrap; gap: 8px; }
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
        console.warn('suggest-followups: styles service unavailable:', error);
      }
      try {
        const tag = document.createElement('style');
        tag.textContent = CSS;
        document.head.appendChild(tag);
      } catch (error) {
        console.warn('suggest-followups: could not install styles:', error);
      }
    }



    function turnIdOf(value) {
      if (typeof value === 'string' && value !== '') return value;
      if (typeof value === 'number') return String(value);
      if (value !== null && typeof value === 'object' && typeof value.turn === 'number') return String(value.turn);
      return undefined;
    }

    function readClickedMap() {
      try {
        const raw = window.localStorage.getItem(CLICKED_KEY);
        const parsed = raw === null ? {} : JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' ? parsed : {};
      } catch (error) {
        console.warn('suggest-followups: could not read clicked state:', error);
        return {};
      }
    }

    function markClicked(clickedId) {
      try {
        const clicked = readClickedMap();
        clicked[clickedId] = true;
        window.localStorage.setItem(CLICKED_KEY, JSON.stringify(clicked));
      } catch (error) {
        console.warn('suggest-followups: could not persist clicked state:', error);
      }
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
      const followups = [];
      for (const item of list) {
        if (item === null || typeof item !== 'object') continue;
        if (typeof item.prompt !== 'string' || item.prompt.trim() === '') continue;
        followups.push({
          prompt: item.prompt,
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



    const captures = new Map();
    const captureListeners = new Set();

    function sessionCaptures(sessionId) {
      let entries = captures.get(sessionId);
      if (entries === undefined) {
        entries = new Map();
        captures.set(sessionId, entries);
      }
      return entries;
    }

    function rememberCapture(sessionId, callId, turn, followups) {
      if (followups === null) return;
      const entries = sessionCaptures(sessionId);
      const previous = entries.get(callId);
      const mergedTurn = turnIdOf(turn) ?? previous?.turn;
      const clickedId = previous?.clickedId
        ?? `sf-${contentHash(`${sessionId}|${mergedTurn ?? callId}|${followups.map((entry) => entry.prompt).join('|')}`)}`;
      entries.set(callId, { turn: mergedTurn, followups, clickedId });
      for (const listener of captureListeners) listener(sessionId);
    }


    function captureForTurn(sessionId, turn) {
      const entries = captures.get(sessionId);
      if (entries === undefined) return null;
      let best = null;
      for (const entry of entries.values()) {
        if (entry.turn === turn) best = entry;
      }
      return best;
    }



    function newestCapture(sessionId) {
      const entries = captures.get(sessionId);
      if (entries === undefined || entries.size !== 1) return null;
      for (const entry of entries.values()) return entry;
      return null;
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
      return (text) => {
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
              console.warn('suggest-followups: composer submit failed:', error);
            }
            return;
          }
          tries += 1;
          window.setTimeout(settle, 25);
        };
        window.setTimeout(settle, 0);
      };
    }

    function FollowupsCard({ entry, sessionId, ctx, t }) {
      const [sentLocally, setSentLocally] = React.useState(() => new Set());
      const [failure, setFailure] = React.useState(null);
      const busyRef = React.useRef(false);

      if (entry === null) return null;
      const clicked = readClickedMap();

      const send = (followup, index) => {
        if (busyRef.current) return;
        busyRef.current = true;
        let sendFollowup;
        try {
          sendFollowup = resolveSend(ctx, sessionId);
        } catch (error) {
          console.warn('suggest-followups: send unavailable:', error);
          setFailure(errorMessage(error));
          busyRef.current = false;
          return;
        }
        Promise.resolve()
          .then(() => sendFollowup(followup.prompt))
          .then(() => {
            markClicked(`${entry.clickedId}:${index}`);
            setSentLocally((previous) => new Set(previous).add(`${entry.clickedId}:${index}`));
            setFailure(null);
          })
          .catch((error) => {
            console.warn('suggest-followups: send failed:', error);
            setFailure(errorMessage(error));
          })
          .finally(() => {
            busyRef.current = false;
          });
      };

      const rows = entry.followups.map((followup, index) => {
        const key = `${entry.clickedId}:${index}`;
        const sent = sentLocally.has(key) || clicked[key] === true;
        return h('button', {
          key,
          type: 'button',
          className: 'dsh-sf-card' + (sent ? ' is-sent' : ''),
          disabled: sent,
          title: followup.prompt,
          'aria-label': followup.prompt,
          onClick: () => {
            if (sent) return;
            send(followup, index);
          }
        },
          h('span', { className: 'dsh-sf-icon', 'aria-hidden': true }, sent ? '✓' : '→'),
          h('span', { className: 'dsh-sf-label' }, displayLabel(followup)),
          sent ? h('span', { className: 'dsh-sf-sr' }, t('srFollowupSent')) : null
        );
      });

      return h('div', { className: 'dsh-sf-root' },
        h('div', { className: 'dsh-sf-header' }, t('header')),
        h('div', { className: 'dsh-sf-row' }, rows),
        failure === null ? null : h('div', { className: 'dsh-sf-error' }, `${t('sendFailed')}${failure}`)
      );
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
          if (followups !== null) rememberCapture(sessionId, callId, turn, followups);
        }
        return null;
      };
    }

    function createTail(ctx) {
      return function SuggestFollowupsTail(props) {
        const sessionId = typeof props.sessionId === 'string' ? props.sessionId : '';
        const turn = turnIdOf(props.turn);
        const [, refresh] = React.useReducer((count) => count + 1, 0);
        React.useEffect(() => {
          captureListeners.add(refresh);
          return () => {
            captureListeners.delete(refresh);
          };
        }, []);



        const entry = turn !== undefined ? captureForTurn(sessionId, turn) : newestCapture(sessionId);
        return h(FollowupsCard, { entry, sessionId, ctx, t: props.t });
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        installStyles(ctx);
        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'suggest-followups: en dictionary');
        ctx.effect(() => {
          try {
            return ctx.locale.register(NS, 'pt-BR', ptBR);
          } catch (error) {
            console.warn('suggest-followups: pt-BR dictionary was not accepted by the locale service:', error);
            return undefined;
          }
        }, 'suggest-followups: pt-BR dictionary');
        ctx.effect(() => {
          try {
            const zhDictionary = require('./locale/zh-CN.json');
            return ctx.locale.register(NS, 'zh-CN', { header: zhDictionary.header, srFollowupSent: zhDictionary.srFollowupSent, sendFailed: zhDictionary.sendFailed });
          } catch (error) {
            console.warn('dsh-nextsteps: zh-CN dictionary was not accepted by the locale service:', error);
            return undefined;
          }
        }, 'dsh-nextsteps: zh-CN dictionary');

        const t = ctx.locale.bind(NS);

        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: TOOL_NAME
        }, createCapture()));

        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail',
          id: 'suggest-followups',
          locale: NS
        }, createTail(ctx)));
      }
    };
  }
});
