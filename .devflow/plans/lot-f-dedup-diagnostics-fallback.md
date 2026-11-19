# Plan: lot F — dedup de quase-idênticas, diagnóstico copiável, modelo reserva

Base: `85edaa2` (store refactor). Repositório `C:\Github\dsh-nextsteps` (plugin `dsh-nextsteps` 1.10.0, client.js ~223KB, host `index.js` + `lib/host/generation-round.mjs`).

## Classificação das ideias

| # | Ideia | Veredito | Prioridade | Superfície |
|---|---|---|---|---|
| 1 | Filtrar sugestões quase idênticas + pedir substituição | **VIÁVEL — implementar** | 1 (menor risco) | host apenas (`generation-round.mjs`), sem setting, sem mudança no client |
| 3 | Modelo reserva em falha/latência | **VIÁVEL — implementar** | 2 (maior superfície) | host + client + setting nova + contract/golden |
| 2 | Copiar diagnóstico do plugin | **VIÁVEL — implementar** | 3 (independente) | client apenas + dicionários |

Restrição de infraestrutura de testes (verificada): `scripts/harness.mjs` apenas enfileira testes no import (harness.mjs:22-35); `run()` é invocado só por `scripts/test.mjs` (harness.mjs:69-73) e importa TODAS as suites sem filtro. **Nenhum `node scripts/suite/X.test.mjs` executa testes** — todo Verify roda `node scripts/test.mjs` (completo, rápido) e, na reconciliação, também `node tools/regression.mjs` + `npm run test:coverage`.

Decisões de design registradas (com tradeoff):
- **Idea 1 sem setting**: o filtro só remove repetições quase idênticas intra-rodada; comportamento sempre ativo. Substituição pedida **apenas quando o dedup encolheu o conjunto abaixo do pedido** (resposta curta sem duplicatas mantém comportamento atual → zero blast radius em respostas honestas).
- **Idea 2, versão do harness**: nenhuma superfície client expõe a versão do harness (grep verificado: só `navigator.clipboard`; `scope.remote.pluginManager` expõe apenas `updateBundle`/`installBundle`; `/.ns/health` devolve só `{ok,name,port}`). O diagnóstico leva versão do plugin + `navigator.userAgent` (ambiente); ausência de versão do harness fica documentada no texto gerado.
- **Idea 2, último erro**: não existe registro persistido (`failedGenerations` vive só em memória, no escopo do painel — client.js:2501). Novo domínio de store `dsh-nextsteps.last-error` com política `skip` em sessão privada (mesma política do audit, client.js:671; `none` NÃO é adequada — na store, `none` escreve mesmo em privado, client.js:541-552), escrito no hook `onFailure` (client.js:2539-2544) passando o sessionId (extraído da generation key `sessionId|turn`, precedente `recordAudit` client.js:1434-1442).
- **Idea 2, idioma do texto**: rótulos estáveis em inglês no blob (artefato técnico para suporte/issue); botão e feedback localizados via dicionários.
- **Idea 3, default off**: "uma opção nas configurações" → opt-in; só tem efeito em modo host (inline mode não tem rodada, `hostMode` client.js:3014).
- **Idea 3, elegibilidade**: repete **uma vez** em qualquer falha **exceto** 409 (chat seguiu adiante) e cancelamento — a fórmula congelada é `error?.cancelled !== true && error?.status !== 409`, o que inclui 502/stream, `timedOut` (estouro do orçamento de latência) e também 400 (ex.: transcript vazio re-falha deterministicamente e propaga o erro original; modelo removido do catálogo pode ter sucesso no default). Repetir é inútil quando o modelo resolvido já é o default do chat — nesse caso não há re-run. Rodada reserva recebe deadline próprio (`budget` fresco); pior caso = 2× budget, e o client dobra o deadline equivalente.
- **Idea 3, origem**: reuso do mecanismo `origin.source` (client.js:1577-1585 aceita qualquer string; chip renderiza em :2763-2772). Novo valor `'fallback'` com branch própria + chave `originFallback`.

## Contrato congelado (interface freeze)

1. **Setting nova**: `fallbackModel: boolean`, default `false`.
   - Host: campo em `settingsLoad` nos DOIS ramos (index.js:384-414) + merge no POST (index.js:680-694) seguindo o padrão dos validadores existentes.
   - Client: `DEFAULT_SETTINGS.fallbackModel = false` (client.js:2994-3008); incluído em `settingsSignature` (client.js:3021-3035); linha na aba Generation com `save({...})` (client.js:3746+).
2. **Valor de origem**: `'fallback'` em `result.source` da resposta `{ ok, rev, followups, model, source }`. Override só quando o source interno é `'transcript'` (resultado de rewrite permanece `'rewrite'`).
3. **Deadline do client**: `startGeneration` (client.js:2565-2568) passa `budget * 2` quando `pluginSettings.fallbackModel === true`; o clamp interno de `start()` (client.js:132) sobe para `LATENCY_MAX_MS * 2` para não cortar a reserva com budget máximo. Ajustar pins de clamp em `client-generation-round.test.mjs` se existirem.
4. **Dedup (host)**: `dedupeFollowups` + comparação normalizada em `generation-round.mjs`, exportadas para testes (precedente: `followupsFromModelText`, :449).
   - Normalização: `lowercase` + sequências não-`\p{L}\p{N}` → um espaço + trim.
   - Quase-idêntico: igualdade normalizada OU Jaccard de conjuntos de tokens ≥ **0.8** (primeira ocorrência vence). CJK sem espaços cai no caso de token único → só igualdade exata (determinístico, conservador; pin de teste).
   - Substituição: no loop de tentativas (generation-round.mjs:388-412), após parse + dedup, se `kept.length < settings.maxFollowups` e ainda não houve substituição nesta rodada e `callSignal` não abortou: **uma** chamada extra com system pedindo `exactly N = missing` itens e avoid estendido (kept + descartadas; mesmos caps do parse de avoid da rota — `index.js:780-787`, constantes `MAX_AVOID_ITEMS=20`/`MAX_AVOID_ITEM_CHARS=200` em index.js:280-281), mesclada, re-dedupada, `slice(0, maxFollowups)`. Compartilha o `callSignal` (mesma deadline).
5. **Elegibilidade da reserva (host route, index.js:789-794)**: `error?.cancelled !== true && error?.status !== 409 && derived.fallbackModel === true` e modelo original ≠ default (comparação via `generation.modelCatalog()` — a instância do round no host se chama `generation`, criada em index.js:618; a exposição existe em generation-round.mjs:449). Re-executa `gate` generate uma vez com `settings.model = ''` (resolve ao default do chat via `resolveRoute`, generation-round.mjs:85-98). Se a reserva também falha, o **erro original** propaga. Fixture mode e rewrite-slot nunca chegam à reserva.
6. **Último erro (client)**: domínio `dsh-nextsteps.last-error`, política `skip` (nada persiste em sessão privada — mesma política do audit, client.js:671), registro `{ message, at, timedOut }` (sem conteúdo do usuário), escrito em `hooks.onFailure` (client.js:2539-2544) passando o sessionId da key (precedente `recordAudit` client.js:1434-1442).
7. **Diagnóstico (client, aba About)**: botão `row(...)` seguindo o padrão de favorites copy (:3644-3650) com `copyText` (:1710-1738) e feedback `setLocalNotice` reutilizando `srCopied`/`copyFailed`. Composição: `plugin dsh-nextsteps <versão>` (fonte: `pluginVersion`/settings GET :3057), `environment: userAgent`, `mode: host|inline` (predicado :3014), `settings:` JSON das ajustes ativos, `metrics:` contagem/média/máx por categoria (mesma fonte de `metricTable` :3498-3519), `last error:` registro do domínio ou `none recorded`.
8. **Chaves de dicionário** (Lane B adiciona nas 3 cópias inline `DICTIONARIES` client.js:2989-2993 **e** nos 3 JSONs `lib/locale/{en,pt-BR,zh-CN}.json`; `package.test.mjs:99-137` exige paridade total):
   - `setFallbackModel`, `setFallbackModelTip`, `originFallback` (`via {model} (fallback)` / `via {model} (reserva)` / `via {model}（备用）`), `diagCopy`, `diagCopyTip`.
9. **Pins de contrato**: `contract.test.mjs:46-52` `Set size == 12` → `13` + regex de enumeração. **Contrato esperado VERMELHO durante as lanes**: o pin lê `index.js` (Lane A) e compara com o que `client.js` envia (Lane B) — falha desde o primeiro toque de Lane A em index.js e só fica verde na reconciliação, quando ambos os lados pousarem. Verificação vinculante do contract: SOMENTE na reconciliação.
10. **Golden replay**: `replay.test.mjs` ganha caso canônico novo `fallback-model` (settings com `fallbackModel: true` + modelo escolhido ≠ default; LLM fake falha na rota escolhida e responde no default). Re-captura com `DSH_REPLAY_CAPTURE=1 node scripts/test.mjs` (env via Git Bash; a captura só grava com todas as keys presentes, replay.test.mjs:30-36 — rodar DEPOIS de A1–A3 prontos); os 11 casos existentes devem permanecer byte-idênticos (dedup não altera — computado sobre golden.json e os `llmText` de host.test.mjs: zero pares quase-duplicados sob a regra congelada).

## Write scopes (disjuntos)

- **Lane A (host)**: `lib/host/generation-round.mjs`, `index.js`, `scripts/suite/host.test.mjs`, `scripts/suite/replay.test.mjs`, `scripts/suite/fixtures/golden.json`, `scripts/suite/contract.test.mjs`.
- **Lane B (client)**: `client.js`, `lib/locale/en.json`, `lib/locale/pt-BR.json`, `lib/locale/zh-CN.json`, `scripts/suite/client.test.mjs`, `scripts/suite/client-generation-round.test.mjs`, `scripts/suite/store.test.mjs`, `.devflow/evidence/*`.
- Somente leitura: todo o resto. Nenhuma lane roda `git commit`.

## Tarefas e critérios de verificação

### Lane A
GATE POR TAREFA (rígido): `node scripts/test.mjs` — **exit 0 exceto `contract`** (vermelho esperado até a reconciliação, ver item 9). Toda falha fora de `contract` é bloqueante.
- A1: `dedupeFollowups` + `nearDuplicatePrompts` exportados (generation-round.mjs:449); integrados no loop de tentativas (:402-407) + substituição única. **Verify**: `node scripts/test.mjs` exit 0 exceto `contract`; testes novos: dedup exato/quase/fronteira 0.8/CJK preservado/substituição dispara só quando encolheu e só uma vez/caps de avoid (20×200).
- A2: fallback no route handler (elegibilidade, re-run com `model: ''`, marcação `source: 'fallback'`, erro original propagando). **Verify**: idem A1; testes novos: fallback em 502, em `timedOut`, em 400 (transcript vazio re-falha e propaga erro original), não em 409/cancelado, não quando modelo já é default, não com setting off, rewrite/fixture intocados.
- A3: setting `fallbackModel` host-side (dois ramos :384-414 + POST merge :680-694) + pin do contract 12→13 (:46-52). **Verify**: idem A1 (pin `contract` continua vermelho — cliente ainda não envia).
- A4: golden: caso `fallback-model` + re-captura revisada (diff do golden.json só ADICIONA o caso). **Verify**: `DSH_REPLAY_CAPTURE=1 node scripts/test.mjs` → revisão do diff de golden.json → `node scripts/test.mjs` exit 0 exceto `contract`, com os 11 casos antigos byte-idênticos.
- Cobertura (só na reconciliação, junto da Lead): `npm run test:coverage` mantém lines 81/functions 79 com código novo 100% coberto.

### Lane B
GATE POR TAREFA (rígido): `node scripts/test.mjs` — **exit 0 exceto `contract`** (vermelho esperado até a reconciliação). Toda falha fora de `contract` é bloqueante.
- B1: setting client-side (DEFAULT_SETTINGS :2994-3008, signature :3021-3035, linha na aba Generation :3746+ com `save({...})`). **Verify**: `node scripts/test.mjs` exit 0 exceto `contract`; teste novo: salvar `fallbackModel: true` persiste via POST e invalida rodadas em voo via signature.
- B2: deadline dobrado em `startGeneration` (:2565-2568) + clamp `LATENCY_MAX_MS * 2` em `start()` (:132; pin existente do clamp em client-generation-round.test.mjs:182 `[65000]` permanece válido — 65000 < 240000). **Verify**: idem B1; teste novo: com fallback on, deadline = 2×budget + slack; com off, inalterado.
- B3: chip de origem `'fallback'` (:2763-2772) + chaves de dicionário nos 3 idiomas (inline `DICTIONARIES` :2989-2993 + `lib/locale/{en,pt-BR,zh-CN}.json`). **Verify**: idem B1 (inclui `package` — paridade de dicionários, package.test.mjs:99-137); teste novo do branch do chip.
- B4: domínio `last-error` política `skip` + escrita em `onFailure` com sessionId (precedente audit :671, :1434-1442). **Verify**: idem B1; testes novos: falha de geração persiste `{message, at, timedOut}` na key `dsh-nextsteps.last-error`; em sessão privada NADA persiste.
- B5: botão de diagnóstico na aba About (:3810-3831) + composição do blob (versão do plugin via `pluginVersion` :3012, userAgent, modo host/inline :3014, settings ativos, métricas :3498-3519, último erro do domínio). **Verify**: idem B1; teste novo com `fakeClipboard`: conteúdo contém versão do plugin, settings ativos, métricas e último erro; feedback `srCopied`/`copyFailed`.

### Reconciliação (Lead, pós-lanes)
- Revisar os diffs de ambas as lanes contra o contrato congelado (nomes, chaves, scopes).
- Preflight completo vinculante: `node scripts/test.mjs` (TODAS as suites, agora inclusive `contract`, exit 0) + `node tools/regression.mjs` (exit 0) + `npm run test:coverage` (thresholds lines 81 / functions 79).
- Anti-flake: `node scripts/test.mjs` ×5 corridas consecutivas (suite completa — é rápida e cobre as suites comportamentais tocadas).

## Riscos
- `contract` vermelho durante as lanes é ESPERADO (bilateral) — vinculante só na reconciliação.
- Pins existentes de clamp/deadline em `client-generation-round.test.mjs` (:182, `[65000]`) permanecem válidos; ajuste só se algum pin conflitar com o clamp `LATENCY_MAX_MS * 2` (mudança de contrato documentada no item 3).
- Golden byte-idêntico nos casos antigos é o tripwire contra blast radius do dedup.
- Cobertura c8 com thresholds — código host novo precisa de testes diretos, não só via route.

## Evidências
`.devflow/evidence/lot-f-run.md` — comandos, contagens, resultados e links de diff.
