import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeHostCtx, withIsolatedHome } from "./harness.mjs";

const LANGUAGES = ["auto", "en", "pt-BR", "zh-CN", "es", "fr", "de", "it", "ja", "ko", "ru", "ar", "hi", "id", "tr", "vi"];

const languageNames = new Map();

function languageNameOf(pluginDir, code) {
  if (languageNames.size === 0) {
    const source = readFileSync(path.join(pluginDir, "index.js"), "utf8");
    const block = /const LANGUAGE_NAMES = \{([\s\S]*?)\n\};/.exec(source)?.[1] ?? "";
    for (const match of block.matchAll(/'?([a-zA-Z-]+)'?\s*:\s*"([^"]+)"/g)) languageNames.set(match[1], match[2]);
  }
  return languageNames.get(code) ?? "";
}

function fakeLlm({ text = '{"followups":[]}', providers, models } = {}) {
  const calls = [];
  return {
    calls,
    listProviders() {
      return providers ?? [{ id: "deepseek", name: "DeepSeek" }, { id: "broken", name: "Broken" }];
    },
    async listModels(provider) {
      if (provider === "broken") throw new Error("the provider is unreachable");
      return models?.[provider] ?? [{ id: "deepseek-chat", name: "DeepSeek Chat" }];
    },
    async prepareCall(route, signal, controls) {
      const capped = controls({ maxTokens: 1000 }, { defaultMaxTokens: 4000 });
      calls.push({ route, signal, controls: capped, system: "" });
      return {
        config: { provider: route.provider, model: route.model },
        async *stream(request) {
          const entry = calls[calls.length - 1];
          if (entry !== undefined) entry.system = request.system;
          yield { type: "text-delta", text };
          yield { type: "finish", reason: { kind: "stop" } };
        }
      };
    }
  };
}

function fakeSessionQuery(events) {
  return {
    async observeSession() {
      return {
        events,
        [Symbol.dispose]() {}
      };
    }
  };
}

function turnEvents(afterSeq) {
  return [
    { seq: 1, type: "user/message", data: { source: { kind: "user" }, content: "please build the thing" } },
    { seq: 2, type: "assistant/message", data: { message: { content: [{ type: "text", text: "done" }] } } },
    { seq: afterSeq, type: "turn/end", data: { reason: { kind: "completed" } } }
  ];
}

export async function runHostSuite(harness, { pluginDir }) {
  await withIsolatedHome(async (home) => {
    const moduleUrl = pathToFileURL(path.join(pluginDir, "index.js")).href;
    const { apply, checkUpdate, name, inject } = await import(moduleUrl);
    const settingsFile = path.join(home, ".dsh", "dsh-nextsteps", "settings.json");

    const llm = fakeLlm({
      text: JSON.stringify({ followups: [{ prompt: "Add the missing tests", label: "Add tests" }] })
    });
    const host = fakeHostCtx({
      llm,
      sessionQuery: fakeSessionQuery(turnEvents(12)),
      agentDefaultModel: { currentSelection: () => ({ provider: "deepseek", model: "deepseek-chat" }) }
    });

    harness.section("host: plugin contract");
    await apply(host.ctx);
    harness.eq("the plugin name", name, "dsh-nextsteps");
    harness.eq("the declared services", inject, ["tools", "connection"]);
    for (const route of ["/api/dsh-nextsteps.settings", "/api/dsh-nextsteps.models", "/api/dsh-nextsteps.generate", "/api/dsh-nextsteps.update"]) {
      harness.check(`the route ${route} is registered`, host.routes.has(route));
    }
    for (const [route, spec] of host.routes) {
      harness.eq(`the route ${route} buffers the body`, spec.requestBody, "buffered");
    }
    harness.eq("the settings route answers GET and POST", host.routes.get("/api/dsh-nextsteps.settings").methods, ["GET", "POST"]);
    harness.eq("the models route answers GET", host.routes.get("/api/dsh-nextsteps.models").methods, ["GET"]);
    harness.eq("the generate route answers POST", host.routes.get("/api/dsh-nextsteps.generate").methods, ["POST"]);
    harness.eq("the update route answers GET", host.routes.get("/api/dsh-nextsteps.update").methods, ["GET"]);
    harness.check("the tool is registered", host.tools.has("suggest_followups"));
    harness.check("the system prompt section is registered", host.sections.some((section) => section.name === "dsh-nextsteps"));
    const section = host.sections.find((entry) => entry.name === "dsh-nextsteps");
    harness.eq("the section carries the plugin order", section.order, 640);
    harness.check("the section text is re-evaluated per turn", typeof section.text === "function");

    harness.section("host: the inject never indexes the services");
    {
      if (host.injects.length === 0) {
        harness.check("the plugin does not rely on an inject callback", true);
      } else {
        const { accessed } = host.runInject(["tools", "systemPrompt"]);
        harness.check("the callback reads the tools service by name", accessed.has("tools"), [...accessed].join(", "));
        harness.check("the callback reads the system prompt service by name", accessed.has("systemPrompt"), [...accessed].join(", "));
        harness.check("the callback never indexes the services as an array", !accessed.has("0") && !accessed.has("1"), [...accessed].join(", "));
      }
    }

    harness.section("host: the language switches without a restart");
    {
      const before = section.text();
      harness.includes("the automatic rule asks for the conversation language", before, "same language the conversation");
      harness.excludes("the automatic rule has no override", before, "LANGUAGE OVERRIDE");

      const response = await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "pt-BR", maxFollowups: 5 })
      }));
      const body = await response.json();
      harness.eq("the settings route accepts the change", body.settings.lang, "pt-BR");
      harness.eq("the settings route accepts the count", body.settings.maxFollowups, 5);

      const after = section.text();
      harness.includes("the section text follows the new language", after, "Brazilian Portuguese");
      harness.includes("the section text carries the override", after, "LANGUAGE OVERRIDE");
      harness.includes("the section text follows the new count", after, "exactly 5 followup prompts");
      harness.check("the section text changed without a restart", before !== after);
      harness.includes("the section says the current statement wins over an earlier one", after, "ignore that earlier statement");

      const stored = JSON.parse(readFileSync(settingsFile, "utf8"));
      harness.eq("the change is written to disk", stored.lang, "pt-BR");
    }

    harness.section("host: the settings route");
    {
      const get = await (await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings"))).json();
      harness.check("the settings come back", get.ok === true && typeof get.version === "string");
      harness.eq("the language comes back", get.settings.lang, "pt-BR");

      const invalid = await (await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "klingon", maxFollowups: 99, showHeader: "yes", model: "no-slash" })
      }))).json();
      harness.eq("an unknown language is ignored", invalid.settings.lang, "pt-BR");
      harness.eq("a count out of range is ignored", invalid.settings.maxFollowups, 5);
      harness.eq("a non-boolean header flag is ignored", invalid.settings.showHeader, true);
      harness.eq("a model without a provider is ignored", invalid.settings.model, "");

      for (const language of LANGUAGES) {
        const result = await (await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lang: language })
        }))).json();
        harness.eq(`the language ${language} is accepted`, result.settings.lang, language);
      }

      const badBody = await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json"
      }));
      harness.check("a malformed body answers 400", badBody.status === 400);
    }

    harness.section("host: the tool contract");
    {
      const tool = host.tools.get("suggest_followups");
      harness.check("the tool exists", tool !== undefined);
      harness.eq("the tool is named", tool.name, "suggest_followups");
      harness.eq("the tool requires the followups", tool.parameters.required, ["followups"]);
      harness.check("the tool description states the order", tool.description.includes("BEFORE writing your final answer"));
      const current = (await (await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings"))).json()).settings;
      harness.check("the tool description states the count", tool.description.includes(`Suggest exactly ${current.maxFollowups} followup prompts`), tool.description.slice(0, 90));
      harness.check("the tool description states the language rule", /write every prompt and label in/i.test(tool.description), tool.description.slice(0, 90));
      harness.check("the tool description states the chosen language", current.lang === "auto" || tool.description.includes(languageNameOf(pluginDir, current.lang)), `${current.lang} → ${languageNameOf(pluginDir, current.lang)}`);

      const cases = [
        { name: "a missing argument", args: {}, problem: /non-empty array/ },
        { name: "a string", args: { followups: "not an array" }, problem: /non-empty array/ },
        { name: "an empty array", args: { followups: [] }, problem: /non-empty array/ },
        { name: "a null item", args: { followups: [null] }, problem: /must be an object/ },
        { name: "a missing prompt", args: { followups: [{ label: "x" }] }, problem: /non-empty `prompt`/ },
        { name: "an empty prompt", args: { followups: [{ prompt: "   " }] }, problem: /non-empty `prompt`/ },
        { name: "an empty label", args: { followups: [{ prompt: "x", label: "" }] }, problem: /`label` must be/ },
        { name: "a non-string label", args: { followups: [{ prompt: "x", label: 7 }] }, problem: /`label` must be/ }
      ];
      for (const entry of cases) {
        const result = await tool.execute(entry.args);
        harness.check(`the tool rejects ${entry.name}`, typeof result === "string" && entry.problem.test(result), String(result).slice(0, 90));
      }
      const ok = await tool.execute({ followups: [{ prompt: "Run the tests", label: "Run tests" }] });
      harness.check("the tool accepts a valid followup", typeof ok === "string" && ok.includes("Followups recorded"), String(ok).slice(0, 90));
      const single = await tool.execute({ followups: { prompt: "Run the tests" } });
      harness.check("the tool accepts a single object", typeof single === "string" && single.includes("Followups recorded"), String(single).slice(0, 90));
      const rendered = tool.output.render({ followups: [{ prompt: "Run the tests" }] }, "ok");
      harness.check("the tool renders the followups", Array.isArray(rendered) && rendered.some((part) => part.text.includes("followups")));
    }

    harness.section("host: the model catalog");
    {
      const response = await host.routes.get("/api/dsh-nextsteps.models").fetch(new Request("http://x/api/dsh-nextsteps.models"));
      const body = await response.json();
      harness.check("the catalog answers", body.ok === true);
      harness.eq("the default comes from the agent model", body.default, { provider: "deepseek", model: "deepseek-chat" });
      harness.eq("a failing provider is skipped", body.groups.length, 1);
      harness.eq("the working provider is listed", body.groups[0].id, "deepseek");
      harness.eq("the models are listed", body.groups[0].models.length, 1);
    }

    harness.section("host: the external generator");
    {
      const response = await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "en", maxFollowups: 3, model: "deepseek/deepseek-chat" })
      }));
      const body = await response.json();
      harness.eq("the model is stored", body.settings.model, "deepseek/deepseek-chat");
      const tool = host.tools.get("suggest_followups");
      harness.check("the tool stays registered in the external mode", tool !== undefined);
      harness.check("the tool stops asking to be called", tool.description.includes("not used any more"), tool.description.slice(0, 80));
      const refused = await tool.execute({ followups: [{ prompt: "x" }] });
      harness.check("the tool refuses to record in the external mode", refused.includes("The host generates"), refused);
      harness.includes("the section tells the agent not to call the tool", section.text(), "must not call any followup tool");

      llm.calls.length = 0;
      const generated = await (await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }))).json();
      harness.check("the generator answers", generated.ok === true && generated.followups.length === 1, JSON.stringify(generated).slice(0, 140));
      harness.eq("the selected model is used", llm.calls[0]?.route, { provider: "deepseek", model: "deepseek-chat" });
      harness.eq("the token budget is capped", llm.calls[0]?.controls.maxTokens, 500);
      harness.includes("the generator is told the language", llm.calls[0]?.system ?? "", "English");
      harness.includes("the generator carries the override", llm.calls[0]?.system ?? "", "LANGUAGE OVERRIDE");
    }
    {
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "deepseek/gone" })
      }));
      const response = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }));
      const body = await response.json();
      harness.check("a model that is gone is refused", response.status === 409 && /no longer listed/.test(body.error), JSON.stringify(body));
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "" })
      }));
    }

    harness.section("host: the generator guards the turn");
    {
      const bad = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "", afterSeq: 12 })
      }));
      harness.check("a missing session answers 400", bad.status === 400);
      const badSeq = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: -1 })
      }));
      harness.check("a bad sequence answers 400", badSeq.status === 400);

      host.setService("sessionQuery", fakeSessionQuery([{ seq: 1, type: "user/message", data: { source: { kind: "user" }, content: "hi" } }]));
      const moved = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }));      harness.check("a turn that moved on answers 409", moved.status === 409, JSON.stringify(await moved.json()));
      host.setService("sessionQuery", fakeSessionQuery(turnEvents(12)));
    }

    harness.section("host: the generator survives the events that arrive after the turn");
    {
      const trailing = [...turnEvents(12), { seq: 13, type: "session/end-seed", data: {} }];
      host.setService("sessionQuery", fakeSessionQuery(trailing));
      llm.calls.length = 0;
      const response = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }));
      const body = await response.json();
      harness.check("an event after the turn end does not refuse the generation", response.status !== 409, `${response.status} ${JSON.stringify(body).slice(0, 120)}`);

      const newer = [...turnEvents(12), { seq: 13, type: "turn/end", data: { reason: { kind: "completed" } } }];
      host.setService("sessionQuery", fakeSessionQuery(newer));
      const moved = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }));
      harness.check("a newer turn still refuses the generation", moved.status === 409, String(moved.status));
      host.setService("sessionQuery", fakeSessionQuery(turnEvents(12)));
    }

    harness.section("host: the automatic mode does not spend a model call");
    {
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "ja", model: "" })
      }));
      llm.calls.length = 0;
      const response = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }));
      const body = await response.json();
      harness.check("the automatic mode answers without suggestions", response.status === 200 && body.followups.length === 0, JSON.stringify(body).slice(0, 120));
      harness.eq("the automatic mode does not call the model", llm.calls.length, 0);
    }

    harness.section("host: the language reaches the generator");
    {
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "ja", model: "" })
      }));
      harness.includes("the section states the language", section.text(), "Japanese");
      harness.includes("the tool description states the language", host.tools.get("suggest_followups").description, "Japanese");

      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "ja", model: "deepseek/deepseek-chat" })
      }));
      harness.includes("the external section tells the agent not to call the tool", section.text(), "must not call any followup tool");
      harness.includes("the external section says the current statement wins", section.text(), "ignore that earlier statement");
      harness.includes("the external tool description says the same", host.tools.get("suggest_followups").description, "not used any more");

      llm.calls.length = 0;
      await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }));
      harness.eq("the model was called", llm.calls.length, 1);
      harness.includes("the generator speaks the chosen language", llm.calls[0]?.system ?? "", "Japanese");
    }

    harness.section("host: the plugin survives a missing service");
    {
      const bare = fakeHostCtx({});
      bare.setService("systemPrompt", undefined);
      await apply(bare.ctx);
      harness.check("the plugin loads without the system prompt service", bare.routes.has("/api/dsh-nextsteps.settings"));
      harness.check("the tool is still registered", bare.tools.has("suggest_followups"));
    }

    harness.section("host: the update check");
    {
      const newer = await checkUpdate(async () => new Response(JSON.stringify({ tag_name: "v9.9.9", body: "notes", html_url: "https://github.com/klaus-2/dsh-nextsteps/releases/tag/v9.9.9" }), { status: 200, headers: { "content-type": "application/json" } }));
      harness.check("a newer release is detected", newer.newer === true && newer.latest === "9.9.9", JSON.stringify(newer));
      harness.eq("the notes are carried", newer.notes, "notes");
      harness.eq("the release page is carried", newer.url, "https://github.com/klaus-2/dsh-nextsteps/releases/tag/v9.9.9");

      const same = await checkUpdate(async () => new Response(JSON.stringify({ tag_name: "v0.0.1", body: "" }), { status: 200, headers: { "content-type": "application/json" } }));
      harness.check("an older release is not newer", same.newer === false);

      const missing = await checkUpdate(async () => new Response("{}", { status: 404 })).then(() => undefined, (error) => error);
      harness.check("a missing release answers with an error", missing !== undefined && /404/.test(String(missing.message)), String(missing?.message));

      const untagged = await checkUpdate(async () => new Response(JSON.stringify({ tag_name: "nightly" }), { status: 200, headers: { "content-type": "application/json" } })).then(() => undefined, (error) => error);
      harness.check("a release without a version is refused", untagged !== undefined && /no x\.y\.z tag/.test(String(untagged.message)), String(untagged?.message));
    }
  });
}
