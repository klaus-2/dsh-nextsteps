export function userMessage(seq, text) {
  return { seq, type: "user/message", data: { content: [{ type: "text", text }], source: { kind: "user" } } };
}

export function assistantMessage(seq, text) {
  return { seq, type: "assistant/message", data: { message: { content: [{ type: "text", text }] } } };
}

export function toolCall(seq, callId, name = "suggest_followups", argsRaw = '{"followups":[{"prompt":"p","label":"l"}]}') {
  return { seq, type: "tool/call", data: { turn: 1, step: 1, callId, name, arguments: argsRaw } };
}

export function turnEnd(seq, turn, kind = "completed") {
  return { seq, type: "turn/end", data: { turn, reason: { kind } } };
}

export function sessionOf(events) {
  return {
    observeSession: async () => ({ events, [Symbol.dispose]: () => {} })
  };
}
