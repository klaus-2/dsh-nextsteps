# dsh-nextsteps

English · [Português (Brasil)](README.pt-BR.md) · [简体中文](README.zh-CN.md)

[![npm](https://img.shields.io/npm/v/dsh-nextsteps)](https://www.npmjs.com/package/dsh-nextsteps) [![license](https://img.shields.io/github/license/klaus-2/dsh-nextsteps)](LICENSE) [![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-e5484d)](https://github.com/deepseek-ai/deepseek-harness)

**Every finished agent turn ends with ready-to-click next steps.**

`dsh-nextsteps` is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that suggests about three followup prompts at the end of every turn, renders them as clickable cards under the completed turn, and sends the clicked prompt as your next message — one click, zero typing. `Auto` lets the answering model write them; an explicit language makes the plugin produce them with its own clean model call, so the cards stay in that language even when the conversation is in another one.

```
dsh plugin --profile web add dsh-nextsteps
```

## Product tour

![Nextsteps demo](docs/assets/demo.gif)

<sub>[Watch full HD video (1280×720, 30 fps MP4)](docs/assets/demo.mp4)</sub>

1. Ask anything. In `Auto` the model writes the cards itself, as the last step before its final answer; with an explicit language or model the plugin generates them after the turn instead.
2. The completed turn renders its own suggestion cards — attributed to that turn, never repeated across messages.
3. Click a card: the prompt is sent verbatim as your next queued message and the card flips to a sent state.
4. Each card also carries an action bar: copy, favourite, edit, discard and expand. Expand reveals the full prompt without sending anything.
5. Everything survives restarts: cards, their turn attribution, and which ones you already clicked.
6. Open the dsh settings → **Nextsteps** to pick the generation language (15 languages or Auto), how many suggestions you get per turn (1–6), the suggestion styles, the generation mode, the latency budget, the suggestion length and whether the small header shows.

## Features

- Per-turn attribution — suggestions stay attached to the turn that produced them, across reloads and app restarts.
- One-click send through the session's own conversation controller, with a composer fallback.
- Persistent captures: clicked cards stay marked after restarts (content-addressed keys, turn backfilled from history).
- Labels, with automatic truncation when absent; strict payload validation with corrective model feedback.
- **Suggestion styles** — a multi-select of *Next action*, *Explore* and *Deep dive*. The generator is told to vary the prompts across the selected angles; the default is all three.
- **On-demand generation** — choose `On demand` and the model is told not to call the tool; a **Generate suggestions** button under the answer asks for the cards instead. The button is there in both the inline and the host mode, and it asks the host exactly once.
- **Copy** a suggestion with one click, straight to the clipboard.
- **Favourites** — keep the suggestions you want to reuse, and copy or remove them from the settings page.
- **Discard** a suggestion you do not want, and **restore** the most recent discard; the discard list lives in the settings page too.
- **Edit** a suggestion before sending it: the edited text is what gets sent, and the stored card is left untouched.
- **Expand** a suggestion to read the full prompt without sending it.
- **Test model** — a button next to the Model setting probes the selected model with one tiny streaming call and shows the time to the first token, or the failure inline.
- **Export** the favourites as a Markdown download, ordered by the date each one was saved.
- **New conversation with this suggestion** — a card action that opens a fresh conversation with the prompt prefilled in the composer; nothing is sent for you.
- **Conversation options** — every conversation can override the global language and followups count from a panel in its header; the override rides the generate request and the global settings stay untouched.
- **Move earlier / Move later** — drag the grip handle on the left of a card onto another card or use the two move buttons; the drag starts after a small movement and lands above or below the target. The order persists per conversation and turn.
- **Try again** — a failed generation shows the error under the cards with a retry button that re-runs exactly one fresh generation round.
- **Card actions on demand** — copy, favourite, edit, discard, move, expand and new-conversation appear when the pointer or the keyboard focus reaches the card; touch devices keep them visible.
- **Nothing under an incomplete turn** — a stopped or failed answer shows no header and no buttons; in on-demand mode a lightweight host probe decides whether the generate button makes sense.
- **Add a suggestion** by hand under the answer, next to the header.
- **Keyboard shortcuts**, local to the card: `c` copies, `f` favourites, `e` edits, `d` discards and `Esc` closes the editor or the expansion; `Enter` and `Space` send the card as usual.
- **A live region** announces each action to screen readers, and the same text is shown next to the cards so nothing is announced silently.
- **Performance metrics** in the settings — the average and the worst duration of the generation, the capture and the card build, with the sample count; a stage with no samples says so instead of showing a fake zero.
- **A latency budget** for the generator (5 000–120 000 ms) and a bounded suggestion length (60–600 characters), so a slow model cannot hold a turn forever.
- **Confirm before sending** — an optional setting turns the first click on a card (and on the new-conversation action) into an armed state; the second click sends, the editor keeps the draft while armed and cancelling disarms.
- **Insert into the composer** — a card action that places the prompt in the composer draft without sending it, so you can edit first.
- **Regenerate a single card** — replaces one suggestion with a fresh single-card generation, keeping the rest of the round intact.
- **Per-conversation generation model** — the conversation options panel can pick a model that rides the generate request, alongside the language and followups overrides.
- **Avoid already-sent suggestions** — the generator receives the prompts already present in the conversation (clicked ones first) and is told not to repeat them.
- **Near-identical suggestions are filtered** — the round's prompts are compared by normalized text (token overlap of at least 0.8) and near-duplicates are dropped; when the filter shrinks the answer below the request, the generator is asked once for replacements that also respect the avoid list.
- **Fallback model** — an opt-in setting repeats a failed or timed-out generation round once with the chat's default model; reserve cards show a fallback origin label, and the client deadline doubles so the reserve can finish.
- **Copy diagnostics** — a button in the About tab copies a support report with the plugin version, environment, active settings, performance metrics and the last recorded error; the harness version is not reachable from the client and the report says so.
- **Star request banner** — the settings page opens with a short banner asking for a GitHub star; following the link shows a brief thank-you, and once you star or dismiss it the banner does not come back.
- **Card origin label** — the last card of a round shows the model that produced it and when, and the label persists with the capture.
- **Safety badges** — heuristic checks flag suggestions that look like prompt-injection attempts or carry credential-like strings; the card shows a badge and sending stays possible.
- **Favourites management** — search, edit the text, bulk copy/remove, JSON export and import (backup and moving between machines), and drag or keyboard reordering; the Markdown export follows the saved order.
- **Elapsed time while generating** — an mm:ss counter under the answer, in both generation modes.
- **Character counter** in the editor, against the configured suggestion length.
- **Gear icon** in the card header opens the plugin's settings page when the host exposes the navigation service.
- **Collapse a turn's cards** — the header button folds that turn's card group away and brings it back; the collapsed state persists per conversation and turn.
- **Duplicate favourites are refused** — favouriting a text that only differs from an existing favourite by whitespace shows the duplicate notice and skips the add; identical text keeps the usual toggle.
- **Custom instruction** — a free-text field in the settings (and per conversation in the options panel) that the generator receives as data; the per-conversation value replaces the global one.
- **Clear the discarded list** — an armed button in the settings empties every persisted discard at once.
- **Not relevant** — a card action that flags a suggestion in place and feeds it to the generator's avoid list (after the already-sent prompts), reversible with a second click.
- **Style badge** — a card can carry a small badge naming the angle the generator gave it — Next action, Explore or Deep dive.
- **Pause suggestions** — a conversation options switch that stops all generation for that conversation; cards captured while paused stay stored but hidden until you resume.
- An incremental capture history: each session keeps its own key and an index tracks the order, so a session you never open is never read.
- Settings page inside the dsh settings — language, followups per turn, styles, generation mode, fallback model, latency budget, suggestion length, header visibility, metrics, favourites, discards, updates, diagnostics.
- An explicit language (or an explicit model) switches to a separate clean model call, so the cards hold that language even in a conversation written in another one; `Auto` with no model follows the conversation inside the turn.
- In-app updater — checks the latest GitHub release (confirmed on npm) about 15 seconds after startup, installs it with one click through the dsh plugin manager, asks for a restart and shows a What's new dialog with the release notes.
- UI in English, Português (Brasil) and 简体中文.

## Keyboard shortcuts and the live region

The shortcuts are **local to the card** — they work when a card has the focus, and they never change what another part of the chat does. `c` copies the prompt, `f` toggles the favourite, `e` opens the editor, `d` discards the card and `Esc` closes the editor or collapses the expansion. A shortcut is ignored while the editor has the focus and whenever a modifier key is held, so the usual editing keys keep working. Every action button carries an `aria-keyshortcuts` attribute, so screen readers announce the shortcut too.

Each action writes its outcome into one live region — a single element with `role="status"` whose text changes — and the same text is shown next to the cards. That is why copying, favouriting, discarding, editing and restoring are all announced once, and why a failed copy tells you it failed instead of looking like a success.

## How the language is enforced

- `Auto` with no model keeps the cards inside the turn: the answering model writes them in the conversation language.
- Any other choice (an explicit language, or an explicit model) moves the cards to a separate clean model call with its own system prompt. The transcript there is data, not instructions, so the cards keep the chosen language even when the conversation is written in another one.
- For Simplified Chinese, Japanese, Korean, Russian, Arabic and Hindi the plugin checks the script of the answer. A reply with none of the target script's characters is discarded — you get no cards rather than cards in the wrong language.
- Near-identical answers are filtered: prompts that repeat the same idea after normalization are dropped, and when the filter shrinks the answer below the request the generator is asked once for replacements.
- If generation fails, no card appears and the reason is written once to the dsh log. Nothing is inserted into the chat.
- With the fallback model on, a failed or timed-out round is repeated once with the chat's default model and the reserve cards are labelled as such.
- With no model selected, the cards use the chat's default model.

The turn still ends with the answer after the tool call, and the plugin adds no to-do nudge and no call cap.

## Settings

Open the dsh settings and find the **Nextsteps** section:

| Setting | What it does |
| --- | --- |
| Language | The language of the followups. `Auto` follows the conversation; any other choice is enforced by a separate clean model call. |
| Model | The model that generates the suggestions. `Auto` uses the chat's model inside the turn; an explicit language or model uses a separate call. |
| Followups per turn | How many suggested prompts are produced (1–6). |
| Suggestion styles | The angles the suggestions should cover: *Next action*, *Explore*, *Deep dive*. Any combination; the default is all three. |
| Generation | `Auto` suggests the followups when the turn ends; `On demand` waits for you to press the button under the answer. |
| Fallback model | When a round fails or runs out of time, it is repeated once with the chat's default model; reserve cards carry a `via <model> (fallback)` origin label. Off by default. |
| Latency budget | How long the generator may run before the request is given up (5 000–120 000 ms). |
| Suggestion length | How long a single prompt may be (60–600 characters). |
| Show header | The small label above the cards. |
| Confirm before sending | The first click on a card arms the send and the second confirms; it also applies to the new-conversation action. |
| Card actions | Pick which actions each card shows and in which order. Uncheck to hide one; uncheck all to hide every action. |
| Retention | Delete stored suggestions older than this many days. 0 turns it off (0-365). Favourites are kept. |
| Transcript scope | How much of the turn the generator sees: the full transcript or only the last user and assistant messages. |

The same page also shows the **performance** table (generation, persistence and rendering, with the average, the worst and the sample count), your **favourites** (copy or remove them) and the **discarded** suggestions (restore them). Those three live only on your machine — they are never sent to the host as settings.

## Privacy and safety

- **Private conversation** — a switch in the conversation options keeps that conversation's cards memory-only: nothing is written to disk while it is on, the stored records of the conversation are purged, and the local audit log drops its entries. The panel shows a warning if the storage refuses the purge.
- **Retention** — an optional age limit (0-365 days) deletes stored suggestions in the background; favourites are kept.
- **Local audit log** — the settings page shows when suggestions were generated and sent, identified by a short hash and length only, never the text; one button clears it.
- **Minimal transcript scope** — an optional setting sends the generator only the last user and assistant messages of the turn instead of the whole transcript (the pure Auto mode reads the conversation inside the turn by nature).
- **Redacted logs** — the plugin's log lines carry error codes, identifiers and metrics, never suggestion text; a suite tripwire guards that.

## Updates

The same settings page keeps the plugin current. About 15 seconds after every startup the plugin checks the latest GitHub release of `dsh-nextsteps` — a read-only check, no credentials — and offers a version only once npm already holds it; the result is shown in the **Updates** row. Nothing installs automatically: **Update now** runs through the dsh plugin manager only when you press it, and the row tells you when dsh needs a restart to finish. After a version is installed, a **What's new** dialog shows its release notes in the interface language, once per version; it carries the same star request as the settings banner and respects the choice you already made there. Copies that were not installed under the `dsh-nextsteps` npm name are manual-update-only: the row reports the new version, but updating goes through Settings → Plugins.

## Requirements

- DeepSeek Harness 0.2.x (desktop, web profile).
- Node.js 20+.

## Development

- `npm test` runs the regression suite and the unit suite.
- `npm run test:coverage` runs the unit suite under the c8 coverage gate over `index.js`, `lib/host/generation-round.mjs`, `lib/host/followup-interpretation.mjs` and `lib/host/conversation-options.mjs`; the gate enforces the measured floor of 81% of lines and 79% of functions.

The generation round is deepened in the host module `lib/host/generation-round.mjs` (gate, model retry, rewrite handoff and error mapping); the client's deadline-bound in-flight controller, probe and request-body builder stay inside `client.js`, because the browser module loader resolves only seed words and bare package names, never a plugin subpath. The host module directory ships in the package `files`; the wire contract — routes, statuses, `source`/`model`/`rev` values, settings and i18n strings — is unchanged.

For deterministic generation during manual QA, export `DSH_NEXTSTEPS_FIXTURE` with a followups JSON payload; the generate route then answers with those cards (normalized by the real validators, `model: "fixture"`, `source: "fixture"`) and never calls the LLM:

```bash
DSH_NEXTSTEPS_FIXTURE='[{"prompt":"Run the tests","label":"Tests"}]'
```

This switch exists for tests and manual QA only: without the variable the route behaves exactly as before (it ignores all per-request overrides — language, count, model, custom instruction and avoid — while set), and the `validate: true` probe is unaffected. The same variable is the fixture hook of the deterministic replay adapter in `scripts/suite/replay.test.mjs`, which restores the previous value after each case and pins the response contract; there is no fixture route or user-facing option.

## Changelog

[CHANGELOG.md](CHANGELOG.md) lists every released change.

## License

[MIT](LICENSE)
