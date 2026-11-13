# Changelog

All notable changes to `dsh-nextsteps` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
