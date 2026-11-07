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
        console.warn('dsh-nextsteps: could not read clicked state:', error);
        return {};
      }
    }

    function markClicked(clickedId) {
      try {
        const clicked = readClickedMap();
        clicked[clickedId] = true;
        window.localStorage.setItem(CLICKED_KEY, JSON.stringify(clicked));
      } catch (error) {
        console.warn('dsh-nextsteps: could not persist clicked state:', error);
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
              console.warn('dsh-nextsteps: composer submit failed:', error);
            }
            return;
          }
          tries += 1;
          window.setTimeout(settle, 25);
        };
        window.setTimeout(settle, 0);
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
    const ICON_DATAURI = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20256%20256%22%20role%3D%22img%22%20aria-label%3D%22Nextsteps%20icon%22%3E%0A%20%20%3Crect%20width%3D%22256%22%20height%3D%22256%22%20rx%3D%2256%22%20fill%3D%22%230d0d10%22%2F%3E%0A%20%20%3Crect%20x%3D%2252%22%20y%3D%2264%22%20width%3D%22152%22%20height%3D%2244%22%20rx%3D%2210%22%20fill%3D%22%231f242b%22%20stroke%3D%22%234b5563%22%20stroke-width%3D%223%22%2F%3E%0A%20%20%3Crect%20x%3D%2252%22%20y%3D%22124%22%20width%3D%22152%22%20height%3D%2244%22%20rx%3D%2210%22%20fill%3D%22%231f242b%22%20stroke%3D%22%234b5563%22%20stroke-width%3D%223%22%2F%3E%0A%20%20%3Crect%20x%3D%2252%22%20y%3D%22184%22%20width%3D%22152%22%20height%3D%2244%22%20rx%3D%2210%22%20fill%3D%22%23e5484d%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M84%20206h72M136%20194l14%2012-14%2012%22%20stroke%3D%22%23ffffff%22%20stroke-width%3D%228%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20fill%3D%22none%22%2F%3E%0A%20%20%3Cpath%20d%3D%22M76%2086h96M76%20146h96%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%227%22%20stroke-linecap%3D%22round%22%2F%3E%0A%3C%2Fsvg%3E%0A';
    const SETTINGS_ROUTE = '/api/dsh-nextsteps.settings';
    const UPDATE_ROUTE = '/api/dsh-nextsteps.update';
    const DICTIONARIES = {
      en: {"header":"Suggested followups","showEarlier":"Show earlier suggestions","hideEarlier":"Hide earlier suggestions","srFollowupSent":"Followup sent","sendFailed":"Could not send: ","intro":"Suggested next-step prompts under every finished agent turn — one click sends the followup.","setLanguage":"Language","setLanguageTip":"Followups are generated in this language. Auto follows the conversation.","optAuto":"Auto (follow the conversation)","optEn":"English","optPt":"Português (Brasil)","optZh":"简体中文","setMax":"Followups per turn","setMaxTip":"How many suggested prompts the model should produce (1-6).","setHeader":"Show header","setHeaderTip":"The small “Suggested followups” label above the cards.","updates":"Updates","current":"Version","checking":"Checking…","upToDate":"up to date","available":"{v} is available","manualCopy":"Development or renamed copy — update it manually.","installing":"Installing {v}…","restartMsg":"Version {v} was installed. Restart the dsh to use it.","noReleases":"No releases published yet","checkFailed":"Update check failed ({e})","updateNow":"Update now","check":"Check for updates","openRelease":"Open release page","releaseNotes":"Release notes","repo":"GitHub repository","issues":"Report an issue"},
      'pt-BR': {"header":"Sugestões de acompanhamento","showEarlier":"Mostrar sugestões anteriores","hideEarlier":"Ocultar sugestões anteriores","srFollowupSent":"Follow-up enviado","sendFailed":"Não consegui enviar: ","intro":"Sugestões de próximos passos sob cada turno concluído do agente — um clique envia o followup.","setLanguage":"Idioma","setLanguageTip":"Os followups são gerados neste idioma. Automático segue a conversa.","optAuto":"Automático (segue a conversa)","optEn":"English","optPt":"Português (Brasil)","optZh":"简体中文","setMax":"Followups por turno","setMaxTip":"Quantas sugestões o modelo deve produzir (1-6).","setHeader":"Mostrar cabeçalho","setHeaderTip":"O rótulo pequeno “Sugestões de acompanhamento” acima dos cartões.","updates":"Atualizações","current":"Versão","checking":"Verificando…","upToDate":"em dia","available":"{v} disponível","manualCopy":"Cópia de desenvolvimento ou renomeada — atualize manualmente.","installing":"Instalando {v}…","restartMsg":"Versão {v} instalada. Reinicie o dsh para usá-la.","noReleases":"Nenhum release publicado ainda","checkFailed":"Falha ao verificar atualizações ({e})","updateNow":"Atualizar agora","check":"Verificar atualizações","openRelease":"Abrir página do release","releaseNotes":"Notas do release","repo":"Repositório no GitHub","issues":"Reportar um problema"},
      'zh-CN': {"header":"建议的后续操作","showEarlier":"显示较早的建议","hideEarlier":"隐藏较早的建议","srFollowupSent":"后续操作已发送","sendFailed":"发送失败：","intro":"在每个智能体回合完成后的下方推荐下一步提示——单击即可发送。","setLanguage":"语言","setLanguageTip":"后续操作提示将以此语言生成。“自动”会跟随对话语言。","optAuto":"自动（跟随对话）","optEn":"English","optPt":"Português (Brasil)","optZh":"简体中文","setMax":"每回合提示数","setMaxTip":"模型应生成的建议提示数量（1-6）。","setHeader":"显示标题","setHeaderTip":"卡片上方的小标题“建议的后续操作”。","updates":"更新","current":"版本","checking":"检查中…","upToDate":"已是最新","available":"{v} 可用","manualCopy":"开发或重命名的副本——请手动更新。","installing":"正在安装 {v}…","restartMsg":"版本 {v} 已安装。请重启 dsh 以使用。","noReleases":"尚未发布任何版本","checkFailed":"检查更新失败（{e}）","updateNow":"立即更新","check":"检查更新","openRelease":"打开发布页","releaseNotes":"发布说明","repo":"GitHub 仓库","issues":"反馈问题"}
    };
    let pluginSettings = { lang: 'auto', maxFollowups: 3, showHeader: true };
    let pluginVersion;

    async function refreshPluginSettings() {
      try {
        const response = await fetch(SETTINGS_ROUTE, { cache: 'no-store' });
        const data = await response.json();
        if (data !== null && typeof data === 'object' && data.ok === true && data.settings !== null && typeof data.settings === 'object') {
          pluginSettings = data.settings;
          if (typeof data.version === 'string') pluginVersion = data.version;
        }
      } catch (error) {
        console.warn('dsh-nextsteps: settings unavailable:', error);
      }
      return pluginSettings;
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
          console.warn('dsh-nextsteps: send unavailable:', error);
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
            console.warn('dsh-nextsteps: send failed:', error);
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
        pluginSettings.showHeader ? h('div', { className: 'dsh-sf-header' }, t('header')) : null,
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
        const [notesOpen, setNotesOpen] = React.useState(false);
        React.useEffect(() => {
          refreshPluginSettings().then((loaded) => setSettings({ ...loaded }));
          check();
        }, []);
        const save = async (patch) => {
          const merged = { ...settings, ...patch };
          setSettings(merged);
          try {
            const response = await fetch(SETTINGS_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
            const data = await response.json();
            if (data !== null && typeof data === 'object' && data.ok === true && data.settings !== null && typeof data.settings === 'object') setSettings(data.settings);
          } catch (error) {
            console.warn('dsh-nextsteps: settings save failed:', error);
          }
        };
        const check = async () => {
          setUpdate((previous) => ({ ...previous, status: 'checking' }));
          try {
            const response = await fetch(UPDATE_ROUTE, { cache: 'no-store' });
            const info = await response.json();
            if (!response.ok || info === null || typeof info !== 'object' || info.error !== undefined) throw new Error(info?.error ?? 'HTTP ' + response.status);
            setUpdate({ status: info.newer === true ? (info.managed ? 'available' : 'manual') : 'current', info });
          } catch (error) {
            setUpdate((previous) => previous.status === 'restart' ? previous : { status: 'error', info: previous.info, error: String(error?.message ?? error) });
          }
        };
        const install = async () => {
          const { info } = update;
          let pluginManager;
          try { pluginManager = ctx.get('remote')?.pluginManager; } catch { pluginManager = undefined; }
          if (info === undefined || pluginManager === undefined || typeof pluginManager.installBundle !== 'function') return;
          setUpdate({ status: 'installing', info });
          try {
            const attempt = async (spec) => {
              const reply = await pluginManager.installBundle(spec, { requestId: NS + '-update-' + info.latest + '-' + Date.now() });
              if (reply === null || typeof reply !== 'object' || reply.ok !== true) throw new Error(reply?.error?.message ?? 'plugin manager did not answer');
              return reply.value;
            };
            let result = await attempt(NPM_NAME + '@' + info.latest);
            if (result !== null && typeof result === 'object' && result.error?.code === 'already-installed') result = await attempt('https://registry.npmjs.org/' + NPM_NAME + '/-/' + NPM_NAME + '-' + info.latest + '.tgz');
            const applied = result !== null && typeof result === 'object' && (result.application === 'applied' || result.application === 'restart-required' || result.version === info.latest);
            if (!applied) {
              const diagnostic = typeof result?.error?.diagnostic === 'string' ? result.error.diagnostic.split('\n').find((entry) => entry.trim() !== '') : undefined;
              throw new Error(diagnostic ?? result?.error?.code ?? 'install failed');
            }
            setUpdate(result.application === 'applied'
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
        return h('div', { 'data-dsh-nextsteps-settings': '' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8 } },
            h('img', { src: ICON_DATAURI, width: 96, height: 54, alt: '', style: { borderRadius: 6, border: '1px solid var(--dsw-alias-border-l1)', flex: 'none' } }),
            h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: '18px' } }, t('intro'))),
          row(t('setLanguage'), t('setLanguageTip'), h('select', { value: settings.lang, onChange: (event) => save({ lang: event.target.value }), style: controlStyle, 'aria-label': t('setLanguage') },
                      h('option', { value: 'auto' }, t('optAuto')),
          ...LANGUAGE_OPTIONS.map((option) => h('option', { key: option.value, value: option.value }, option.label))), 'lang'),
          row(t('setMax'), t('setMaxTip'), h('input', { type: 'number', min: 1, max: 6, value: settings.maxFollowups, onChange: (event) => save({ maxFollowups: Number(event.target.value) }), style: { ...controlStyle, width: 64 }, 'aria-label': t('setMax') }), 'max'),
          row(t('setHeader'), t('setHeaderTip'), h('input', { type: 'checkbox', checked: settings.showHeader, onChange: (event) => save({ showHeader: event.target.checked }), 'aria-label': t('setHeader') }), 'header'),
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '14px 0', borderBottom: '.5px solid var(--dsw-alias-border-l1)', flexWrap: 'wrap' } },
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, t('updates')),
              h('div', { style: { fontSize: 12, color: statusColor, marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'center' } },
                h('span', null, t('current') + ': ' + (info.current ?? pluginVersion ?? '?')),
                h('span', null, statusText),
                typeof info.notes === 'string' && info.notes !== '' ? h('button', { onClick: () => setNotesOpen(!notesOpen), style: { background: 'none', border: 'none', padding: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' } }, t('releaseNotes')) : null)),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' } },
              update.status === 'available' ? h('button', { onClick: install, style: { ...linkStyle, fontWeight: 600 } }, t('updateNow')) : null,
              h('button', { onClick: check, style: linkStyle }, t('check')),
              typeof info.url === 'string' ? h('a', { href: info.url, target: '_blank', rel: 'noreferrer', style: linkStyle }, t('openRelease')) : null)),
          update.status === 'available' && info.notes && notesOpen ? h('pre', { style: { background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 10, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' } }, info.notes) : null,
          h('div', { style: { display: 'flex', gap: 8, padding: '14px 0', flexWrap: 'wrap' } },
            h('a', { href: 'https://github.com/klaus-2/dsh-nextsteps', target: '_blank', rel: 'noreferrer', style: linkStyle }, t('repo')),
            h('a', { href: 'https://github.com/klaus-2/dsh-nextsteps/issues', target: '_blank', rel: 'noreferrer', style: linkStyle }, t('issues'))));
      };
    }
    return {
      inject: ['slots', 'locale', 'remote'],
      apply(ctx) {
        installStyles(ctx);
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
      }
    };
  }
});
