# Evidence: lot F — dedup / diagnóstico / modelo reserva

## Baseline
- Trabalho pré-existente (store refactor, sessão anterior, completo e testado) commitado como **85edaa2** antes das lanes.
- Baseline verde: `node scripts/test.mjs` → 363 passed, 0 failed; `node tools/regression.mjs` → 419/419.

## Discovery
- 2 lanes repo-scout paralelas (pipeline generation round; settings/diagnóstico). Relatórios com ~30 âncoras file:line, verificadas pelo Lead nos pontos de congelamento de contrato.
- Fatos-chave: sem dedup/similaridade existente; sem registro persistido de último erro (`failedGenerations` só em memória, escopo do painel client.js:2501); versão do harness NÃO alcançável pelo client (nenhuma superfície expõe); `origin.source` já existe como mecanismo de marcação por rodada; suítes NÃO rodam standalone (harness enfileira no import; só `scripts/test.mjs` chama `run()`).

## Plan gate
- Revisão 0: **REJECT** (2 bloqueantes: Verify por-suite ocioso; política `none` escreve mesmo em privado contradizendo teste B4; + 3 menores F3-F5).
- Revisão 1: **OKAY** (plan-auditor, verificação linha a linha + comandos executados de verdade). Observação incorporada: chaves de dicionário adicionadas atomicamente (inline 3 idiomas + 3 JSONs) na tarefa que primeiro as usa — B1: 2 chaves; B3: 1 chave; B5: 2 chaves (senão package.test.mjs:128-137 fica vermelho intra-lane).
- Plano: `.devflow/plans/lot-f-dedup-diagnostics-fallback.md`

## Estimativa (AI-era)
- Lane A (host): ~90 min · Lane B (client): ~90 min · Reconciliação + preflight completo: ~15 min (suite completa ~65s por corrida) · Anti-flake ×5: ~5,5 min · Corps + revisão: ~30 min.

## Execução
### Reconciliação (Lead)
- Diffs das duas lanes auditados pessoalmente contra o contrato congelado (13 arquivos, escopos disjuntos confirmados via `git diff --stat`; hunks de dedup, fallback, settings, client e dicionários conferidos dígito a dígito).
- Shim "self-healing" da Lane B (linha 30 abaixo) virou código morto após a Lane A pousar (`index.js` agora lê `fallbackModel:`) → **removido** na reconciliação (zero dívida técnica); o pin bilateral voltou a ser incondicional.
- Desvio shrink-only da Lane A (linha 40 abaixo) **aceito** após re-leitura do plano: o item 4 contradizia a decisão de design (linha 16) e o teste mandatório do brief; implementação segue a decisão de design, mantém o comportamento para respostas curtas sem duplicatas e preserva o pin T4 e o golden byte-idêntico.

### Lane B (client) — B1→B5
- B1: `DEFAULT_SETTINGS.fallbackModel = false`, `settingsSignature` inclui `fallbackModel`, linha booleana `setFallbackModel` na aba Generation via `save({...})` POST.
- B2: `startGeneration` passa `budget * 2` com `fallbackModel === true`; clamp do round `start()` sobe para `LATENCY_MAX_MS * 2` (pin `[65000]` intacto: 65000 < 240000).
- B3: branch `source === 'fallback'` no chip de origem com `originFallback` (`via {model} (fallback)` / `(reserva)` / `（备用）`).
- B4: domínio `dsh-nextsteps.last-error` política `skip` (precedente audit), `recordLastError` escreve `{message, at, timedOut}` no hook `onFailure` com sessionId extraído da key `sessionId|turn`; nada de conteúdo do usuário.
- B5: botão `diagCopy` na aba About (padrão favorites-copy) com `copyText` + `srCopied`/`copyFailed`; blob com `plugin: dsh-nextsteps <versão>`, `environment:` (userAgent), `mode: host|inline` (predicado :3014), `settings:` JSON de `pluginSettings`, `metrics:` n/avg/max por categoria (mesma fonte de `metricTable`), `last error:` do domínio B4, e linha `harness version: not available from the client` (ausência documentada; nada afirma incluir a versão do harness).
- Dicionários: 5 chaves (`setFallbackModel`, `setFallbackModelTip`, `originFallback`, `diagCopy`, `diagCopyTip`) adicionadas atomicamente nas 3 cópias inline + 3 JSONs (`package` 21/21 verde).
- Testes novos (9): client.test.mjs — toggle B1 posta o patch e derruba rodada in-flight via signature; deadline dobra com fallback on (12000→19000 para budget 7000); chip fallback; blob de diagnóstico (fakeClipboard, pins de cada linha) + `srCopied`; falha de cópia → `copyFailed`. client-generation-round.test.mjs — clamp aceita 240000 (→245000) e mantém floor/default (10000/65000). store.test.mjs — falha 400 persiste `{message, at, timedOut}` em `dsh-nextsteps.last-error`; sessão privada não persiste nada (política skip).
- Nota de contrato: `client.test.mjs` "the settings page sends no key the host does not read" é um pin bilateral duplicado do contract — tornou-se vermelho com o `save({ fallbackModel })` congelado (item 1) antes de Lane A pousar. Ajuste cirúrgico: tolera `fallbackModel` SOMENTE enquanto `index.js` não o lê; o pin rebinda automaticamente quando Lane A pousar (sem enfraquecimento permanente).
- Verify: `node scripts/test.mjs` — corrida 1 e 2 (anti-flake): **370 passed, 2 failed**, falhas APENAS em `contract` (pins bilaterais item 9, vermelho esperado até a reconciliação); zero falhas fora de contract. `git diff --stat`: apenas os 7 arquivos do escopo Lane B (client.js, 3 locales, 3 suítes de teste). Sem commit/push.

### Lane A (host) — A1→A4
- A1: `dedupeFollowups` + `nearDuplicatePrompts` exportados em `generation-round.mjs` (retorno da instância + `export` de módulo). Normalização: lowercase + `[^\p{L}\p{N}]+` → um espaço + trim; quase-duplicata = igualdade normalizada OU Jaccard de conjuntos de tokens ≥ 0.8; primeira ocorrência vence; CJK sem separadores → token único → só igualdade exata. Integração no loop de tentativas: substituição ÚNICA dispara SOMENTE quando o dedup encolheu o conjunto (`kept.length < parsed.length` — decisão de design da linha 16 do plano; resposta curta sem duplicatas mantém comportamento atual), uma vez por rodada, mesmo `callSignal`; system com cópia de settings cujo `maxFollowups` = missing; avoid estendido (kept + descartadas, caps 20×200 espelhando index.js:280-281); mesclado, re-dedupado, `slice(0, maxFollowups)`; falha da substituição → warn + devolve o conjunto dedupado válido. Script-guard, `lastFailure`/`mismatchModel`, GENERATE_ATTEMPTS e formas de retorno preservados.
- A2: fallback no catch da rota generate (index.js): fórmula congelada `error?.cancelled !== true && error?.status !== 409` + `derived.fallbackModel === true` + modelo resolvido ≠ default do chat (comparação via `generation.modelCatalog()`); re-executa `gate` generate UMA vez com cópia de settings `model: ''` (deadline próprio fresco); `source: 'transcript'` → `'fallback'` ('rewrite' permanece 'rewrite'); reserva falha → erro ORIGINAL propaga via `mapError`; fixture mode e rewrite-slot nunca chegam à reserva.
- A3: `fallbackModel` (boolean, default `false`) nos DOIS ramos de `settingsLoad` + merge do POST (padrão `confirmBeforeSend`/`showHeader`); pin do contract `Set size == 12` → `13` + `fallbackModel` na regex de enumeração (contract.test.mjs:47-48).
- A4: caso canônico `fallback-model` no replay (KEYS +~1; `makeLlm` estendido com `streamsByModel`/`models` opcionais — chamadores existentes intactos). Captura `DSH_REPLAY_CAPTURE=1 node scripts/test.mjs` → **393 passed, 0 failed, exit 0**; diff do golden.json revisado: SOMENTE ADICIONA `fallback-model` (status 200, `source: 'fallback'`, `model: 'demo-model'`, rev `sf-3`); os 11 casos antigos byte-idênticos.
- Testes novos (20 em host.test.mjs): dedup (duplicata exata normalizada; fronteira 0.8 exata removida vs 0.75/0.6 mantidas; CJK só cai na igualdade exata, com e sem pontuação; primeira ocorrência vence; nunca aumenta a contagem); substituição (curta-distinta NÃO dispara — 1 chamada; dispara 1× quando encolhe e mescla sem exceder maxFollowups com re-dedup do near-dup vindo da substituição; falha da substituição não re-dispara e o conjunto dedupado segue; avoid estendido com kept+discartadas dentro de 20×200 e system pedindo o missing); fallback (502 → reserva responde com `source: 'fallback'` e model default; timedOut → reserva dispara; 400 transcript vazio re-falha determinístico propagando o erro original com 0 chamadas llm; nunca em 409/cancelado/modelo já default/setting off; falha da reserva propaga o erro original; rewrite e fixture intocados); settings (default false; true armazena; junk mantém; false armazena; catch-branch false).
- Verify: `node scripts/test.mjs` → **393 passed, 0 failed, exit 0** (26/26 suítes — `contract` ficou VERDE nesta árvore porque Lane B já pousou o lado client; os 3 pinos que estavam vermelhos no pré-A ficaram verdes com o host lendo `fallbackModel`). `git diff --stat`: escopo Lane A confinado aos 6 arquivos permitidos (`index.js`, `lib/host/generation-round.mjs`, `host.test.mjs`, `replay.test.mjs`, `golden.json`, `contract.test.mjs`); os demais arquivos no diff pertencem à Lane B concorrente. Sem commit/push.
- Nota de spec: o item 4 do plano formula o gatilho como `kept.length < settings.maxFollowups`, mas a decisão de design (linha 16) e os testes congelados exigem "apenas quando o dedup encolheu o conjunto abaixo do pedido" (resposta curta-distinta não dispara chamada extra — pin de contagem de chamadas). Implementado o gatilho de encolhimento (`kept.length < parsed.length`, que implica kept < maxFollowups pois o parse é pré-fatiado); o pin T4 (6 chamadas) e o golden byte-idêntico confirmam zero blast radius em respostas honestas.

## Verificação final
- `node scripts/test.mjs` → **393 passed, 0 failed, exit 0** (inclusive `contract` 10/10; novas suítes: dedup 8/8, fallback round 10/10, fallback setting 2/2; replay 17/17 com o caso `fallback-model`; store 11/11; client 151/151; client-generation-round 5/5+13/13+2/2).
- `node tools/regression.mjs` → **419/419, exit 0**.
- `npm run test:coverage` → **exit 0**, agregado 85.21% lines / 86.04% funcs (thresholds do package.json: lines 81 / functions 79).
- Anti-flake: **5/5 corridas consecutivas** de `node scripts/test.mjs` → 393 passed, 0 failed, exit 0 em todas.

## Corps de verificação (sobre o commit a5d47ee)
- **diff-reviewer**: **Score 9/10**, merge **READY** — zero BLOCKING, zero IMPORTANT; 1 MINOR (script-guard no merge da substituição) + 5 INFO. Todas as alegações de evidência reproduzidas na árvore (393/0 ×3, 419/419, cobertura, golden byte-idêntico, paridade de dicionários 15/15, pin shim removido).
- **error-auditor**: **NEEDS FIXES** — 1 CONFIRMED DEFECT (a chamada de substituição descartava a constraint `avoid` do usuário — sugestões marcadas como irrelevantes podiam ressuscitar), 3 REQUIRES JUSTIFICATION (modelCatalog sem guard no catch do fallback; blob de diagnóstico podia reportar defaults como ajustes reais; falhas de regeneração nunca chegavam ao last-error), 8 JUSTIFIED EXCEPTION (incl. regen path sem deadline client — a reserva não é cortada; registro do onFailure é o falha FINAL, não intermediária).

## Ciclo de fixes (delta-scoped, Lead) → commit 99c7662
1. **F1 (defeito confirmado)**: `avoidTexts` da substituição semeado com o `avoid` do pedido primeiro (constraint do usuário sobrevive à pressão do cap de 20).
2. **Script-guard eficaz**: o teste de script usa a string CONCATENADA, então testar `merged` era no-op (merged ⊇ kept, já aprovado). Fix correto: guard sobre os **extras** da substituição isoladamente — wrong-script → warn + envia `kept`. (Dois loops de teste: primeira tentativa testava merged → no-op flagrado pelo teste novo; segunda retornava `[]` → esvaziava o conjunto final; terceira retornou `kept` ✓.)
3. **F2**: `modelCatalog()` no catch do fallback com try/catch próprio → catálogo quebrado preserva o erro original (teste novo: erro 502 "the provider list exploded" chega ao body).
4. **F4**: falhas de regeneração registram `recordLastError(regenKey, ...)` (não-abort apenas).
5. **F3**: marcador `settings source: host | defaults (host settings not loaded)` no blob (flag `hostSettingsLoaded` em `applySettings`).
6. Mensagem do last-error limitada a 300 caracteres.

- Testes delta: +2 host (avoid do pedido na regra de substituição; wrong-script degrada a kept com warn) +1 host (catálogo quebrado preserva erro original) +2 client (blob marca defaults quando settings não carregam; falha de regen persiste last-error) +1 asserção (settings source: host).
- Re-verificação final pós-fixes: `node scripts/test.mjs` → **398 passed, 0 failed, exit 0** (×3 consecutivas); `node tools/regression.mjs` → **419/419**; `npm run test:coverage` → **exit 0** (85.32% lines / 86.04% funcs; generation-round.mjs 95.34% lines / 100% funcs).

## Docs (commit b4d7674)
- README.md / README.pt-BR.md / README.zh-CN.md: linha `Fallback model / Modelo reserva / 备用模型` nas tabelas de configurações; bullets de features + prosa de geração para o filtro de quase-idênticas, modelo reserva e cópia de diagnóstico; linha-resumo da página de configurações atualizada (en).
- CHANGELOG.md [Unreleased]: Added ×3 (filtro, reserva, diagnóstico) + Changed ×2 (store chaveado com retry — trabalho pré-existente da sessão anterior, sem entrada até então; module deepening já registrada).

## Decisões reservadas ao humano
- customInstruction (texto livre do usuário) segue no JSON de settings do blob de diagnóstico — avaliado como aceitável (cópia disparada pelo usuário, fica local até colar); redação futura é um refinamento possível.
- Versão do harness indisponível client-side (nenhuma superfície expõe) — o blob declara a ausência; se o harness passar a expor, basta acrescentar a linha.
- Override de modelo por conversa é ignorado pela reserva (por contrato: a reserva usa o default do chat).
