# Changelog

All notable changes to `dsh-nextsteps` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Near-identical suggestions are filtered.** The generation round compares its prompts by normalized text (lowercased, punctuation collapsed; token overlap of at least 0.8 counts as the same idea) and drops near-duplicates, first occurrence wins. When the filter shrinks the answer below the requested count, the generator is asked exactly once for replacements, with the kept and discarded prompts plus the user's avoid list as constraints; a replacement that comes back in the wrong script is rejected and the kept set ships.
- **Fallback model.** A new `fallbackModel` setting (off by default) repeats a failed or timed-out generation round once with the chat's default model; reserve cards carry the `via <model> (fallback)` origin label and the client deadline doubles so the reserve can finish. The reserve never runs on a moved-on conversation (409) or a cancellation, and if it also fails the original error is what reaches the UI.
- **Copy diagnostics.** A button in the About tab copies a support report with the plugin version, the environment user agent, whether the plugin runs in host or inline mode, the active settings (with an explicit marker of whether host settings were loaded), the performance metrics and the last recorded generation error. The harness version is not reachable from the client and the report says so.

### Changed

- **Local writes go through a retrying keyed store.** Every localStorage write in the client runs through `createLocalStore`, which batches writes, retries refused writes with a backoff (250 ms, 1 s, 4 s) before dropping with a warning, and applies the per-domain private-session policies; the capture, favourites, audit, metrics and session domains share one mechanism.
- **The generation round is deepened in a host module, with the wire contract unchanged.** The host gate, model retry, rewrite handoff and error mapping moved to `lib/host/generation-round.mjs`; the client's deadline-bound in-flight controller, probe and request-body builder stay inline in `client.js` so the browser module loader can resolve the bundle. The host module directory ships in the package `files`. Routes, statuses, `source`/`model`/`rev` values, settings and i18n strings are unchanged; the golden replay adapter in `scripts/suite/replay.test.mjs` still pins the response contract.

## [1.10.0] - 2026-11-16

### Added

- **Collapse a turn's cards** — a button in the turn header folds that turn's card group away and brings it back; the collapsed state persists per conversation and turn (memory-only for private conversations), and captures that arrive while collapsed join the hidden group.
- **Duplicate favourites are refused** — favouriting a text that differs from an existing favourite only by whitespace shows the duplicate notice and skips the add; identical text keeps the usual toggle, and the comparison stays case-sensitive so code-like prompts are not falsely merged.
- **Custom instruction for the suggestions** — a free-text settings field (capped at 500 characters) and a per-conversation field in the conversation options panel; the generator receives the text as data alongside the transcript, and the per-conversation value replaces the global one for its requests.
- **Clear the discarded list** — an armed button next to the discarded list in the settings empties every persisted discard at once; in-memory private discards are unaffected.
- **Mark a suggestion as not relevant** — a card action flags the suggestion in place (muted card, flag glyph, reversible) and feeds the marked prompts to the generator's avoid list, ordered after the already-sent prompts, so similar suggestions stop coming.
- **Style badge on the card** — suggestions can carry their angle from the generator (`next-action`, `explore`, `deep-dive`); the card shows a small badge naming it, the rewrite re-attaches the original style by index, and unknown or absent styles render no badge (plugin revision `sf-3`).
- **Pause suggestions in a conversation** — a switch in the conversation options stops every generation path for that conversation (auto, on-demand button and probe); captures that arrive while paused stay stored but hidden, and unpausing reveals them. The conversation reset also clears the pause.

## [1.8.1] — 2026-11-14

### Fixed

- **Suggestion generation re-rolls a failed model call within the latency budget.** One failed or timed-out upstream round used to end the request as "the generator answered with HTTP 502"; the plugin now tries the model call again within the configured budget before it reports a failure, and the failure line carries the actual server error instead of the bare status code. ([`9fe7824`](https://github.com/klaus-2/dsh-nextsteps/commit/9fe7824))
- **A truncated model answer no longer discards its complete suggestions.** An answer cut off by the token cap parsed as nothing and the cards showed "the generator answered without suggestions"; the generator now recovers the complete suggestion objects from the truncated text, and the answer token cap rose from 500 to 1024 so a six-suggestion reply does not truncate in the first place. ([`9fe7824`](https://github.com/klaus-2/dsh-nextsteps/commit/9fe7824))
- **A turn without conversation content explains itself.** Asking for suggestions on a turn with no messages answered an empty list that the panel reported as a generic generation failure; the route now refuses with "this turn has no conversation content to suggest from". ([`9fe7824`](https://github.com/klaus-2/dsh-nextsteps/commit/9fe7824))

## [1.8.0] — 2026-11-14

The plugin update system moves to a loopback server of the plugin's own, authenticated by an instance secret, and the version check reads the npm registry only. Updates install through the dsh plugin manager when it is available and through the plugin's own pnpm install route when it is not.

### Added

- **Update checks read the npm registry.** The version check asks `registry.npmjs.org` for the latest `dsh-nextsteps` release and never touches the GitHub API, so a release without notes still shows up in the update row. ([`100ee32`](https://github.com/klaus-2/dsh-nextsteps/commit/100ee32))
- **Update now works without a plugin manager.** When the dsh plugin manager refuses the spec or is absent, the plugin's own install route runs `pnpm add dsh-nextsteps@X.Y.Z` with the runtime pnpm, and the row names the version that actually landed on disk — including the case where pnpm holds a too-recent release back. ([`100ee32`](https://github.com/klaus-2/dsh-nextsteps/commit/100ee32))
- **Development copies are refused politely.** A checkout carrying `.git` answers the update row with "Local development copy — update with git pull." instead of a generic install failure. ([`100ee32`](https://github.com/klaus-2/dsh-nextsteps/commit/100ee32))

### Changed

- **The update flow runs on the plugin's own loopback server.** Health, update check and install live behind `127.0.0.1` ports 47497–47516 under a `/.ns/` prefix, authenticated with an instance secret stored in the plugin profile (`dsh-nextsteps/instance.secret`); the dsh channel keeps settings, models, model test and generation, and gains a secret route the panel reads. ([`100ee32`](https://github.com/klaus-2/dsh-nextsteps/commit/100ee32))
- **The version you see is the version that runs.** The panel reports the version from a `PLUGIN_VERSION` constant in `index.js`, and the publish workflow fails when it drifts from `package.json`. ([`100ee32`](https://github.com/klaus-2/dsh-nextsteps/commit/100ee32))

### Fixed

- **A failed update check no longer claims there are no releases published.** An unreachable registry or server shows the failure inline, and a check that fails while an install is pending keeps showing the version that awaits the restart. ([`100ee32`](https://github.com/klaus-2/dsh-nextsteps/commit/100ee32))
- **Discovery retries instead of dying once.** If the loopback server or the secret route is unreachable in one check, the next "Check for updates" walks the port block again instead of staying unreachable for the whole session. ([`100ee32`](https://github.com/klaus-2/dsh-nextsteps/commit/100ee32))

## [1.7.1] — 2026-11-13

### Fixed

- **Cards build again when the suggestions arrive after an empty turn tail.** The 1.7.0 empty-tail rule made the first render return null, so the deferred-render observer never found its root: the header appeared, the cards stayed on the `…` placeholder, and no followup ever rendered in conversations where the generation landed after the tail first mounted. The observer now re-arms when the tail starts rendering, so the cards build as soon as they exist.
  ([`1b79483`](https://github.com/klaus-2/dsh-nextsteps/commit/1b79483))

## [1.7.0] — 2026-11-13

### Added

- **Test model.** A button next to the Model setting probes the selected model with one tiny streaming call (a fixed 15 s bound and a small token cap) and shows the time to the first text token, or the failure inline — no settings write, no retries.
- **Export favourites as Markdown.** The settings page downloads the favourites list as a `.md` file ordered by the date each one was saved; prompts that carry their own code fence render as indented blocks.
- **New conversation with this suggestion.** A card action opens a fresh conversation with the prompt prefilled in the composer via `uiWorkspace.startSession`; nothing is sent for you, the source card stays untouched, and a missing workspace service degrades to a notice.
- **Per-conversation language and count.** A panel in the card header overrides the global language and followups count for one conversation (stored in `dsh-nextsteps.session-overrides`); any override engages host generation for that session and rides the `/generate` request, where the host merges it into one derived settings object. Global settings and revisions are untouched.
- **Drag to reorder cards.** A grip handle on each card plus move-earlier/move-later buttons reorder the suggestions; the order persists per conversation and turn in `dsh-nextsteps.card-order` (capped at 40 keys) and stale ids degrade to the natural order.
- **Retry after a generation failure.** A terminally failed generation shows the error under the cards with a "Try again" button that re-runs exactly one fresh generation round; conflicts, aborts and settings changes never offer a retry.

### Changed

- **The grip sits left of the card and drags with the pointer.** The cardline row keeps the handle and the card on one line, the drag starts after a 6 px movement and lands above or below the target by its midpoint, and a cancelled pointer never reorders. The HTML5 drag-and-drop path is gone — dragging the glyph itself was the old failure.
- **Per-card actions reveal on demand.** Copy, favourite, edit, discard, move, expand and new-conversation hide until the pointer or the keyboard focus reaches the card; touch devices keep them visible. Editor, undo and footer rows stay always visible.
- **Nothing renders under an incomplete turn.** A stopped, failed or otherwise unanswered turn shows no header and no buttons anymore: the host answers a lightweight `validate` probe on the generate route — no model call, a 4 s bound — and the on-demand button only appears for a genuinely completed turn. The retry row and the undo-discard row survive the empty-tail rule.

## [1.6.1] — 2026-11-12

### Fixed

- **Host-mode generation no longer disappears silently.** The plugin asked the host for suggestions using the seq of the closing assistant node, but the host matches the request against the seq of the `turn/end` event. The two differ whenever a turn produced traffic after its last message, so the host answered `409` and the plugin dropped the result: no cards, no warning, nothing in the log. The request now carries the seq of the `turn/end` event the turn carries, with the bare seq kept as a fallback for callers that hand over a turn that is already closed.

## [1.6.0] — 2026-11-12

### Added

- **Suggestion styles.** Pick which angle the model takes — next action, explore, deep dive — with multi-select in the settings. An invalid or empty selection keeps the current one instead of clearing it.
- **Discard with undo.** Hide a suggestion you do not want; restore it from the card or from the settings page.
- **Manual suggestions.** Write your own followup prompt under the answer. Each one keeps its own identity, so two identical texts stay independent.
- **Card expansion.** Read the full prompt before sending it.
- **One-click copy.** Copy any suggestion, with a visible fallback that works even when the clipboard is blocked, and a failure that is announced instead of looking like a success.
- **Favourites.** Keep the prompts you reuse and copy or remove them from the settings page.
- **Local card shortcuts.** `c`, `f`, `e`, `d` and `Esc`, scoped to the card.
- **Edit before send.** Tweak any suggestion; the edited text is what gets sent and the stored card is left untouched.
- **Performance metrics.** Persistence, rendering and generation timings, with average, worst case and sample count, in the settings page.
- **Bounded payload.** Suggestion length is capped and re-validated on both halves, in inline mode as well as in host mode.
- **Obsolete-generation cancellation.** Switching turns or unmounting cancels the in-flight request instead of letting it finish.
- **Incremental history index.** Captures are stored per session behind an explicit index, so sessions opened in earlier runs survive a reload. A legacy store is migrated on first run and kept whenever a write cannot be confirmed.
- **Asynchronous capture persistence.** Writes are coalesced with a retry ladder; a failing store is dropped with exactly one warning per key.
- **Deferred rendering.** Old cards are built lazily when they scroll into view, with a fallback that builds them at once when no observer is available.
- **On-demand generation.** In both modes: the model writes the cards inline, or you press a button under the answer and the plugin generates them. A stray tool call in on-demand mode never becomes a card.
- **Latency budget with retry.** A configurable budget, one retry, and exactly one warning per failed turn.

### Fixed

- A corrupt or wrong-shape legacy capture store no longer stops the plugin from booting.
- The capture cap of 400 holds on disk as well as in the index, and the two agree.
- A missing model and a model that is no longer listed are reported instead of being swallowed; `409` is reserved for "the chat moved on".
- Discarding and favouriting are reflected on the card on the click's own render, not on a later one.
- The copy fallback leaves no hidden field behind, even when the copy command throws.

## [1.5.2] — 2026-11-11

### Fixed

- Follow-up cards now appear right when the turn ends. They used to start generating only after the turn finished, which delayed them by several seconds. The model now writes the drafts at its usual tool call, and the plugin rewrites them into the chosen language while the answer is still streaming. The draft call is also required in every turn, including short questions, so the slow fallback path is gone from the common case.

## [1.5.1] — 2026-11-11

### Fixed

- Follow-up cards now appear as soon as the turn ends. They used to start generating only after the turn finished, so they arrived a few seconds late. The model now writes the drafts at its usual tool call, and the plugin rewrites them into the chosen language while the answer is still being written. When the model skips the tool, the plugin still falls back to generating from the transcript.

## [1.5.0] — 2026-11-11

### Fixed

- Follow-up cards now stay in the language you chose. The cards used to be whatever the answering model wrote at the end of the turn; in a conversation pasted or continued in another language, the model's own context outweighed the language setting. An explicit language — or an explicit model — now moves the cards to a separate, clean model call that does not see the chat's system prompt, memory or pasted conversation. `Auto` with no model keeps the previous in-turn behaviour.

## [1.4.11] — 2026-11-08

### Fixed

- The update check no longer fails when GitHub's hourly quota runs out. The version now comes from the registry; the release notes are read from GitHub on a best-effort basis, and a blocked notes request no longer breaks the check.

## [1.4.10] — 2026-11-08

### Removed

- The "Release notes" link in the update row. It opened a panel that only appeared while an update was waiting, so it looked broken, and the release page button next to it already carries the notes.

## [1.4.9] — 2026-11-08

### Fixed

- The language rule says out loud what it overrides. The rule now states plainly that neither the conversation language nor a saved preference about how you usually write applies to the cards.
