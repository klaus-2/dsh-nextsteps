# dsh-nextsteps

[![npm](https://img.shields.io/npm/v/dsh-nextsteps)](https://www.npmjs.com/package/dsh-nextsteps)
[![license](https://img.shields.io/github/license/klaus-2/dsh-nextsteps)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-e5484d)](https://github.com/deepseek-ai/deepseek-harness)

**Every finished agent turn ends with ready-to-click next steps.**

`dsh-nextsteps` is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that prompts the model to suggest about three followup prompts at the end of every turn, renders them as clickable cards under the completed turn, and sends the clicked prompt as your next message — one click, zero typing.

```
dsh plugin --profile web add dsh-nextsteps
```

## How it works

1. The plugin registers a native `suggest_followups` agent tool with a strict JSON Schema.
2. At the end of its turn, the model calls it with about three followup prompts.
3. Each completed turn renders its own suggestion cards — attributed to that turn, never repeated across messages.
4. Click a card: the prompt is sent verbatim as your next queued message and the card flips to a sent state.

## Features

- Per-turn attribution — suggestions stay attached to the turn that produced them, across reloads.
- One-click send through the session's own conversation controller, with a composer fallback.
- Clicked cards persist (content-addressed keys) and stay marked after reloads.
- Model-supplied labels, with automatic truncation when absent; strict payload validation with corrective model feedback.
- Settings page inside the dsh settings — language, followups per turn, header visibility, updates.
- Followups generated in the selected language (Auto follows the conversation).
- In-app updater — version check, one-click install, release notes, restart prompt.
- UI in English, Português (Brasil) and 简体中文.

## Settings

Open the dsh settings and find the **Nextsteps** section:

| Setting | What it does |
| --- | --- |
| Language | The language the model writes followups in. `Auto` follows the conversation. |
| Followups per turn | How many suggested prompts the model produces (1–6). |
| Show header | The small label above the cards. |

## Updates

The same settings page checks GitHub for new releases. When a newer version is published on npm, **Update now** installs it through the dsh plugin manager and asks you to restart. Updates only ever install the `dsh-nextsteps` npm package — a renamed or development copy is detected and left alone.

## Requirements

- DeepSeek Harness 0.2.x (desktop, web profile).
- Node.js 20+.

## License

[MIT](LICENSE)
