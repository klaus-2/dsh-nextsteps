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
- UI in English, Português (Brasil) and 简体中文.

## Requirements

- DeepSeek Harness 0.2.x (desktop, web profile).
- Node.js 20+.

## License

[MIT](LICENSE)
