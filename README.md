# dsh-nextsteps

English · [Português (Brasil)](README.pt-BR.md) · [简体中文](README.zh-CN.md)

[![npm](https://img.shields.io/npm/v/dsh-nextsteps)](https://www.npmjs.com/package/dsh-nextsteps) [![license](https://img.shields.io/github/license/klaus-2/dsh-nextsteps)](LICENSE) [![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-e5484d)](https://github.com/deepseek-ai/deepseek-harness)

**Every finished agent turn ends with ready-to-click next steps.**

`dsh-nextsteps` is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that suggests about three followup prompts at the end of every turn, renders them as clickable cards under the completed turn, and sends the clicked prompt as your next message — one click, zero typing. `Auto` lets the answering model write them; an explicit language makes the plugin produce them with its own clean model call, so the cards stay in that language even when the conversation is in another one.

```
dsh plugin --profile web add dsh-nextsteps
```

## Product tour

![Nextsteps demo loop](docs/assets/demo.svg)

1. Ask anything. In `Auto` the model writes the cards itself, as the last step before its final answer; with an explicit language or model the plugin generates them after the turn instead.
2. The completed turn renders its own suggestion cards — attributed to that turn, never repeated across messages.
3. Click a card: the prompt is sent verbatim as your next queued message and the card flips to a sent state.
4. Everything survives restarts: cards, their turn attribution, and which ones you already clicked.
5. Open the dsh settings → **Nextsteps** to pick the generation language (15 languages or Auto), how many suggestions you get per turn (1–6), and whether the small header shows.

## Features

- Per-turn attribution — suggestions stay attached to the turn that produced them, across reloads and app restarts.
- One-click send through the session's own conversation controller, with a composer fallback.
- Persistent captures: clicked cards stay marked after restarts (content-addressed keys, turn backfilled from history).
- Labels, with automatic truncation when absent; strict payload validation with corrective model feedback.
- Settings page inside the dsh settings — language, followups per turn, header visibility, updates.
- An explicit language (or an explicit model) switches to a separate clean model call, so the cards hold that language even in a conversation written in another one; `Auto` with no model follows the conversation inside the turn.
- In-app updater — version check, one-click install, release notes, restart prompt.
- UI in English, Português (Brasil) and 简体中文.

## How the language is enforced

- `Auto` with no model keeps the cards inside the turn: the answering model writes them in the conversation language.
- Any other choice (an explicit language, or an explicit model) moves the cards to a separate clean model call with its own system prompt. The transcript there is data, not instructions, so the cards keep the chosen language even when the conversation is written in another one.
- For Simplified Chinese, Japanese, Korean, Russian, Arabic and Hindi the plugin checks the script of the answer. A reply with none of the target script's characters is discarded — you get no cards rather than cards in the wrong language.
- If generation fails, no card appears and the reason is written once to the dsh log. Nothing is inserted into the chat.
- With no model selected, the cards use the chat's default model.

The turn still ends with the answer after the tool call, and the plugin adds no to-do nudge and no call cap.

## Settings

Open the dsh settings and find the **Nextsteps** section:

| Setting | What it does |
| --- | --- |
| Language | The language of the followups. `Auto` follows the conversation; any other choice is enforced by a separate clean model call. |
| Followups per turn | How many suggested prompts are produced (1–6). |
| Show header | The small label above the cards. |

## Updates

The same settings page checks GitHub for new releases. When a newer version is published on npm, **Update now** installs it through the dsh plugin manager and asks you to restart. Updates only ever install the `dsh-nextsteps` npm package — a renamed or development copy is detected and left alone.

## Requirements

- DeepSeek Harness 0.2.x (desktop, web profile).
- Node.js 20+.

## License

[MIT](LICENSE)
