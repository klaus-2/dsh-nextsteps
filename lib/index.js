// SPDX-License-Identifier: MIT
const TOOL_NAME = 'suggest_followups';

const name = 'dsh-nextsteps';


const inject = ['tools'];

const DESCRIPTION = [
  'MANDATORY in every turn: call this tool exactly once, at the very end of your turn, after your written answer and all other tool calls, to suggest about 3 followup prompts the user is likely to want next. Never finish a turn without calling it.',
  'Good suggestions include alternatives to the latest implementation, related features, cleanup opportunities, tests to add, or verification steps you could run yourself; if plan steps remain, one suggestion may be continuing with the next step.',
  'Each prompt must be short (usually one sentence), goal-oriented — name the outcome, not the steps — stand alone without conversation context, and be phrased in the user\'s first-person voice.',
  'Never suggest actions the user would carry out themselves outside this session (e.g. "commit these changes"); judge by the tools you actually have.',
  'This never waits for an answer: it returns immediately and your turn ends normally.',
  'Example input:',
  '{"followups":[{"prompt":"Show me how to run the test suite","label":"Run tests"},{"prompt":"Add error handling for empty uploads","label":"Handle empty uploads"},{"prompt":"What about handling streaming updates?","label":"Streaming updates"}]}'
].join('\n');

function coerceFollowups(raw) {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (error) {
      return undefined;
    }
  }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.followups)) {
    raw = raw.followups;
  }
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) raw = [raw];
  return raw;
}


function validationProblem(followups) {
  const shape = followups === undefined || followups === null ? 'nothing usable'
    : Array.isArray(followups) ? `array(${followups.length})`
    : typeof followups;
  if (!Array.isArray(followups) || followups.length === 0) {
    return `Error: \`followups\` must be a non-empty array (aim for 3) of objects with a non-empty \`prompt\` string and an optional short \`label\` string. Received ${shape}. Retry with valid followups.`;
  }
  for (const followup of followups) {
    if (followup === null || typeof followup !== 'object') {
      return 'Error: each followup must be an object with a non-empty `prompt` string. Retry with valid followups.';
    }
    if (typeof followup.prompt !== 'string' || followup.prompt.trim() === '') {
      return 'Error: each followup needs a non-empty `prompt` string (the message sent when the user clicks). Retry with valid followups.';
    }
    if (followup.label !== undefined && (typeof followup.label !== 'string' || followup.label.trim() === '')) {
      return 'Error: `label` must be a short non-empty string when present. Retry with valid followups.';
    }
  }
  return null;
}

const PARAMETER_SCHEMA = {
  type: 'object',
  properties: {
    followups: {
      type: 'array',
      description: 'List of suggested followup prompts the user can click to send. Aim for 3.',
      items: {
        type: 'object',
        additionalProperties: false,
        description: 'One suggested followup card.',
        properties: {
          prompt: {
            type: 'string',
            description: 'The message sent verbatim when the user clicks; short, goal-oriented, first-person.'
          },
          label: {
            type: 'string',
            description: 'Short display label for the card, 2-5 words; defaults to a truncated prompt.'
          }
        },
        required: ['prompt']
      }
    }
  },
  required: ['followups']
};


const PLUGIN_REV = 'sf-1';

function toolSpec() {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: PARAMETER_SCHEMA,
    output: {
      schema: { type: 'string' },
      render: (args, value) => [
        { type: 'text', text: value },


        { type: 'text', text: JSON.stringify({ rev: PLUGIN_REV, followups: coerceFollowups(args.followups) ?? [] }) }
      ]
    },
    async execute(args) {
      const followups = coerceFollowups(args.followups);
      const problem = validationProblem(followups);
      if (problem !== null) return problem;
      return 'Followups suggested! End your turn.';
    }
  };
}

function apply(ctx) {




  try {
    ctx.tools.register(toolSpec());
  } catch (error) {
    console.error('suggest-followups: tool registration failed:', error);
  }
}

export { name, inject, apply };
