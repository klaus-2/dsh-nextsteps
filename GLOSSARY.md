# dsh-nextsteps

The vocabulary of the followup cards the plugin offers at the end of a chat turn, and of the cycle that produces them.

## Language

### Content

**Turn**:
A completed exchange in a chat session. Followups belong to the Turn that produced them, not to the session at large.
_Avoid_: message, exchange, answer

**Followup**:
A suggested next prompt offered to the user when a Turn completes. It is the unit the plugin produces, checks, stores and sends.
_Avoid_: suggestion, next step, quick reply

**Card**:
A Followup as rendered in the chat, together with its action bar and state.
_Avoid_: tile, widget, UI element

**Capture**:
The stored record of the Followups of a Turn, including which of them were sent.
_Avoid_: save, stored card, snapshot

**Favourite**:
A Followup the user keeps for reuse across conversations.
_Avoid_: bookmark, saved prompt

**Discard**:
A Followup the user marks as unwanted, from which the user can still restore it.
_Avoid_: delete, trash, reject

### Process

**Generation round**:
One cycle that produces Followups for a Turn, from deciding that the Turn is complete to handing over the result.
_Avoid_: generation, generation pass, request

**Rewrite**:
A Generation round in which the answering model writes the Followups itself, before its answer finishes.
_Avoid_: inline generation, tool generation

**Fixture**:
Followups supplied for tests and manual QA in place of a model call, so the round is deterministic.
_Avoid_: mock, fake response, stub

**Rewrite handoff**:
The point in a Generation round where a Rewrite completed before the answer finished is passed to generation instead of calling the model again.
_Avoid_: rewrite lookup, rewrite cache

**Time source**:
The single scoped clock a Generation round uses to bound its work and compose cancellation, so a round can be replayed without waiting on real time.
_Avoid_: timer, deadline

**Fixture adapter**:
The test-side switch that supplies a Fixture for one round and restores the previous value afterwards, so the round can be replayed deterministically.
_Avoid_: fixture route, mock server

### Privacy

**Privacy mode**:
A per-conversation setting that keeps that conversation's Captures in memory only and purges what was stored.
_Avoid_: incognito, private browsing

**Audit log**:
The local record of when Followups were generated and sent, identified by hash and length rather than by their text.
_Avoid_: telemetry, history, trace
