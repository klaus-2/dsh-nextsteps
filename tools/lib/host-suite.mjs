import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { fakeHostCtx, flush, freePort, extractFunction, withIsolatedHome, withStubbedFetch } from "./harness.mjs";

const LANGUAGES = ["auto", "en", "pt-BR", "zh-CN", "es", "fr", "de", "it", "ja", "ko", "ru", "ar", "hi", "id", "tr", "vi"];

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
      calls.push({ route, signal, controls: capped, system: "", messages: [] });
      return {
        config: { provider: route.provider, model: route.model },
        async *stream(request) {
          const entry = calls[calls.length - 1];
          if (entry !== undefined) {
            entry.system = request.system;
            entry.messages = request.messages;
          }
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
    const hostSource = readFileSync(path.join(pluginDir, "index.js"), "utf8");
    const pluginVersion = JSON.parse(readFileSync(path.join(pluginDir, "package.json"), "utf8")).version;
    const moduleUrl = pathToFileURL(path.join(pluginDir, "index.js")).href;
    const { apply, name, inject, startServer } = await import(moduleUrl);
    const settingsFile = path.join(home, ".dsh", "dsh-nextsteps", "settings.json");
    const secretHeader = "x-dsh-nextsteps-secret";

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
    harness.check("the host binds the frozen loopback block", hostSource.includes("const DEFAULT_PORT = 47497;") && hostSource.includes("const PORT_ATTEMPTS = 20;"), "the loopback block must stay at 47497 with 20 attempts");
    for (const route of ["/api/dsh-nextsteps.settings", "/api/dsh-nextsteps.models", "/api/dsh-nextsteps.model-test", "/api/dsh-nextsteps.generate", "/api/dsh-nextsteps.secret"]) {
      harness.check(`the route ${route} is registered`, host.routes.has(route));
    }
    for (const [route, spec] of host.routes) {
      harness.eq(`the route ${route} buffers the body`, spec.requestBody, "buffered");
    }
    harness.eq("the settings route answers GET and POST", host.routes.get("/api/dsh-nextsteps.settings").methods, ["GET", "POST"]);
    harness.eq("the models route answers GET", host.routes.get("/api/dsh-nextsteps.models").methods, ["GET"]);
    harness.eq("the model-test route answers POST", host.routes.get("/api/dsh-nextsteps.model-test").methods, ["POST"]);
    harness.eq("the generate route answers POST", host.routes.get("/api/dsh-nextsteps.generate").methods, ["POST"]);
    harness.eq("the secret route answers GET", host.routes.get("/api/dsh-nextsteps.secret").methods, ["GET"]);
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
      harness.includes("the section asks for the drafts in host mode", after, "Call suggest_followups exactly once");
      harness.check("the section text changed without a restart", before !== after);
      harness.includes("the section says the current statement wins over an earlier one", after, "ignore that earlier statement");

      const stored = JSON.parse(readFileSync(settingsFile, "utf8"));
      harness.eq("the change is written to disk", stored.lang, "pt-BR");

      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "auto", maxFollowups: 5 })
      }));
      const inline = section.text();
      harness.includes("the inline section follows the conversation", inline, "same language the conversation");
      harness.includes("the inline section follows the new count", inline, "exactly 5 followup prompts");
      harness.excludes("the inline section has no override", inline, "Call suggest_followups exactly once");
    }

    harness.section("host: the settings route");
    {
      const get = await (await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings"))).json();
      harness.check("the settings come back", get.ok === true && typeof get.version === "string");
      harness.eq("the language comes back", get.settings.lang, "auto");

      const invalid = await (await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "klingon", maxFollowups: 99, showHeader: "yes", model: "no-slash" })
      }))).json();
      harness.eq("an unknown language is ignored", invalid.settings.lang, "auto");
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
      harness.check("the tool description states the language rule", /write every prompt and label in/i.test(tool.description), tool.description.slice(0, 90));
      harness.check("the tool description delegates the count", tool.description.includes("stated in the nextsteps section"), tool.description.slice(0, 90));

      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "auto", model: "" })
      }));

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
      const refused = await tool.execute({ followups: [{ prompt: "x" }] });
      harness.check("the tool records the drafts in the external mode", refused.includes("Followups recorded"), refused);
      const refusedRender = tool.output.render({ followups: [{ prompt: "x" }] }, refused);
      harness.check("the external render hides the card bytes", refusedRender.length === 1 && refusedRender[0].text === refused, JSON.stringify(refusedRender).slice(0, 90));
      harness.includes("the section asks for the drafts", section.text(), "Call suggest_followups exactly once");

      llm.calls.length = 0;
      const generated = await (await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }))).json();
      harness.check("the generator answers", generated.ok === true && generated.followups.length === 1, JSON.stringify(generated).slice(0, 140));
      harness.eq("the selected model is used", llm.calls[0]?.route, { provider: "deepseek", model: "deepseek-chat" });
      harness.eq("the token budget is capped", llm.calls[0]?.controls.maxTokens, 1024);
      harness.includes("the generator is told the language", llm.calls[0]?.system ?? "", "English");
      harness.includes("the generator carries the override", llm.calls[0]?.system ?? "", "ABSOLUTE LANGUAGE RULE");
      harness.includes("the generator treats the transcript as data", llm.calls[0]?.system ?? "", "DATA");
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
      harness.check("a model that is gone is refused with a configuration error", response.status === 400 && /no longer listed/.test(body.error), JSON.stringify(body));
      harness.includes("the configuration error names the model", String(body.error), "no longer listed");
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "" })
      }));
    }
    {
      host.setService("agentDefaultModel", undefined);
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...args) => { warnings.push(args.join(" ")); };
      try {
        const response = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "session-no-model", afterSeq: 12 })
        }));
        const body = await response.json();
        harness.eq("no model is a configuration error, not a cancellation", response.status, 400);
        harness.includes("the error names the missing model", String(body.error), "no model is selected");
        harness.check("the configuration error is reported", warnings.some((line) => line.includes("generation failed")), warnings.join(" | "));
      } finally {
        console.warn = originalWarn;
        host.setService("agentDefaultModel", { currentSelection: () => ({ provider: "deepseek", model: "deepseek-chat" }) });
      }
    }

    harness.section("host: the generator survives a malformed model reply");
    {
      const malformed = fakeLlm({ text: JSON.stringify({ followups: [null, { label: "sem prompt" }, { prompt: "   " }, { prompt: "Rodar o build", label: "Rodar build" }] }) });
      host.setService("llm", malformed);
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "pt-BR", model: "" })
      }));
      const response = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }));
      const body = await response.json();
      harness.check("a malformed reply answers 200", response.status === 200, JSON.stringify(body).slice(0, 120));
      harness.eq("only the usable followup survives", body.followups.length, 1);
      host.setService("llm", llm);
    }

    harness.section("host: the tool is registered once across a settings change");
    {
      const tool = host.tools.get("suggest_followups");
      let unregisterCalls = 0;
      host.ctx.tools.unregister = () => { unregisterCalls += 1; };
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "pt-BR" })
      }));
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "auto" })
      }));
      harness.check("the tool survives the settings change", host.tools.get("suggest_followups") === tool);
      harness.eq("only one tool is registered", host.tools.size, 1);
      harness.eq("the plugin never unregisters the tool", unregisterCalls, 0);
    }

    harness.section("host: a failed generation warns exactly once");
    {
      host.setService("sessionQuery", undefined);
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...args) => { warnings.push(args.join(" ")); };
      try {
        const response = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "session-warn", afterSeq: 12 })
        }));
        harness.check("the failure answers 502", response.status === 502, String(response.status));
      } finally {
        console.warn = originalWarn;
        host.setService("sessionQuery", fakeSessionQuery(turnEvents(12)));
      }
      harness.eq("the host warns exactly once", warnings.filter((line) => line.includes("generation failed")).length, 1);
    }

    harness.section("host: an explicit model alone selects host mode");
    {
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "auto", model: "deepseek/deepseek-chat" })
      }));
      harness.includes("the section asks for the drafts", section.text(), "Call suggest_followups exactly once");
      const refused = await host.tools.get("suggest_followups").execute({ followups: [{ prompt: "x" }] });
      harness.check("the tool records the drafts", refused.includes("Followups recorded"), refused);
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "" })
      }));
    }

    harness.section("host: the script guard keeps the target script and discards latin");
    {
      const cases = [
        { lang: "ja", keep: "デプロイする", drop: "Deploy it" },
        { lang: "ko", keep: "테스트 실행", drop: "Run tests" },
        { lang: "hi", keep: "परीक्षण चलाएँ", drop: "Run tests" }
      ];
      for (const entry of cases) {
        host.setService("llm", fakeLlm({ text: JSON.stringify({ followups: [{ prompt: entry.keep, label: "x" }] }) }));
        await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lang: entry.lang, model: "" })
        }));
        const kept = await (await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
        }))).json();
        harness.eq(`the ${entry.lang} reply survives the guard`, kept.followups.length, 1);
        host.setService("llm", fakeLlm({ text: JSON.stringify({ followups: [{ prompt: entry.drop, label: "x" }] }) }));
        const dropped = await (await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
        }))).json();
        harness.eq(`a latin reply is discarded for ${entry.lang}`, dropped.followups.length, 0);
      }
      host.setService("llm", llm);
    }

    harness.section("host: the generator trims to the configured count");
    {
      host.setService("llm", fakeLlm({ text: JSON.stringify({ followups: [{ prompt: "a" }, { prompt: "b" }, { prompt: "c" }, { prompt: "d" }] }) }));
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "pt-BR", maxFollowups: 2 })
      }));
      const body = await (await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }))).json();
      harness.eq("the host trims to maxFollowups", body.followups.length, 2);
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxFollowups: 3 })
      }));
      host.setService("llm", llm);
    }

    harness.section("host: the drafts are rewritten before the turn ends");
    {
      const events = [
        { seq: 1, type: "user/message", data: { source: { kind: "user" }, content: "corrija o parser" } },
        { seq: 2, type: "tool/call", data: { turn: 1, step: 1, callId: "call-1", name: "suggest_followups", arguments: "{}" } },
        { seq: 3, type: "assistant/message", data: { message: { content: [{ type: "text", text: "done" }] } } },
        { seq: 12, type: "turn/end", data: { reason: { kind: "completed" } } }
      ];
      host.setService("sessionQuery", fakeSessionQuery(events));
      const rewriteLlm = fakeLlm({ text: JSON.stringify({ followups: [{ prompt: "Rodar os testes", label: "Testes" }] }) });
      host.setService("llm", rewriteLlm);
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "pt-BR", model: "" })
      }));
      const tool = host.tools.get("suggest_followups");
      await tool.execute({ followups: [{ prompt: "Run tests", label: "Tests" }] }, { callId: "call-1", agent: { id: "session-1" } });
      const body = await (await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }))).json();
      harness.eq("the rewritten card is served", body.followups[0]?.prompt, "Rodar os testes");
      harness.eq("the rewrite is the only model call", rewriteLlm.calls.length, 1);
      harness.eq("the response names the rewrite source", body.source, "rewrite");
      host.setService("llm", llm);
      host.setService("sessionQuery", fakeSessionQuery(turnEvents(12)));
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

      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...args) => { warnings.push(args.join(" ")); };
      try {
        host.setService("sessionQuery", fakeSessionQuery([{ seq: 1, type: "user/message", data: { source: { kind: "user" }, content: "hi" } }]));
        const moved = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "session-409-silence", afterSeq: 12 })
        }));
        harness.check("a turn that moved on answers 409", moved.status === 409, JSON.stringify(await moved.json()));
        harness.check("a routine 409 is silent", warnings.every((line) => !line.includes("generation failed")), warnings.join(" | "));
        host.setService("sessionQuery", undefined);
        const failed = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "session-409-silence", afterSeq: 12 })
        }));
        harness.check("a later genuine failure still answers", failed.status === 502, String(failed.status));
        harness.check("a later genuine failure is warned", warnings.some((line) => line.includes("generation failed")), warnings.join(" | "));
      } finally {
        console.warn = originalWarn;
        host.setService("sessionQuery", fakeSessionQuery(turnEvents(12)));
      }
    }

    harness.section("host: the validate flag probes the turn without a model call");
    {
      llm.calls.length = 0;
      const probe = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12, validate: true })
      }));
      const probeBody = await probe.json();
      harness.check("a completed turn validates true", probe.status === 200 && probeBody.ok === true && probeBody.completed === true, JSON.stringify(probeBody).slice(0, 120));
      harness.eq("the probe never calls the model", llm.calls.length, 0);

      host.setService("sessionQuery", fakeSessionQuery([
        { seq: 1, type: "user/message", data: { source: { kind: "user" }, content: "please build the thing" } },
        { seq: 12, type: "turn/end", data: { reason: { kind: "aborted" } } }
      ]));
      const aborted = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12, validate: true })
      }));
      const abortedBody = await aborted.json();
      harness.check("an aborted turn validates false", aborted.status === 200 && abortedBody.ok === true && abortedBody.completed === false, JSON.stringify(abortedBody).slice(0, 120));

      host.setService("sessionQuery", { observeSession: async () => { throw new Error("the session is unavailable"); } });
      const failed = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12, validate: true })
      }));
      const failedBody = await failed.json();
      harness.check("a failing observation answers false instead of 5xx", failed.status === 200 && failedBody.ok === true && failedBody.completed === false, `${failed.status} ${JSON.stringify(failedBody).slice(0, 120)}`);

      const bad = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ afterSeq: 12, validate: true })
      }));
      harness.check("the validation runs before the probe", bad.status === 400);

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

    harness.section("host: a plain conversation without content is refused");
    {
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "auto", model: "" })
      }));
      llm.calls.length = 0;
      host.setService("sessionQuery", fakeSessionQuery([{ seq: 12, type: "turn/end", data: { reason: { kind: "completed" } } }]));
      const response = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }));
      const body = await response.json();
      harness.check("an empty transcript is refused with a clear error", response.status === 400 && String(body.error).includes("no conversation content"), JSON.stringify(body).slice(0, 120));
      harness.eq("an empty transcript does not call the model", llm.calls.length, 0);
      host.setService("sessionQuery", fakeSessionQuery(turnEvents(12)));
    }

    harness.section("host: an explicit language reaches the clean generator");
    {
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "ja", model: "" })
      }));
      harness.includes("the explicit section asks for the drafts", section.text(), "Call suggest_followups exactly once");
      harness.includes("the explicit section says the current statement wins", section.text(), "ignore that earlier statement");
      harness.includes("the explicit tool description is static", host.tools.get("suggest_followups").description, "BEFORE writing your final answer");
      harness.excludes("the explicit tool description no longer names a language", host.tools.get("suggest_followups").description, "Japanese");

      const japanese = fakeLlm({ text: JSON.stringify({ followups: [{ prompt: "テストを実行する", label: "テスト" }] }) });
      host.setService("llm", japanese);
      await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }));
      harness.eq("the default model is called once without a chosen model", japanese.calls.length, 1);
      harness.eq("the default route comes from the agent model", japanese.calls[0]?.route, { provider: "deepseek", model: "deepseek-chat" });
      harness.includes("the generator speaks the chosen language", japanese.calls[0]?.system ?? "", "Japanese");
      host.setService("llm", llm);
    }

    harness.section("host: the non-latin script guard discards a wrong-script reply");
    {
      const arabic = fakeLlm({ text: JSON.stringify({ followups: [{ prompt: "Check the CI wiring", label: "CI" }] }) });
      host.setService("llm", arabic);
      await host.routes.get("/api/dsh-nextsteps.settings").fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "ar", model: "" })
      }));
      const response = await host.routes.get("/api/dsh-nextsteps.generate").fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }));
      const body = await response.json();
      harness.check("a latin reply for an arabic target is discarded", response.status === 200 && body.followups.length === 0, JSON.stringify(body).slice(0, 120));
      host.setService("llm", llm);
    }

    harness.section("host: the plugin survives a missing service");
    {
      const bare = fakeHostCtx({});
      bare.setService("systemPrompt", undefined);
      await apply(bare.ctx);
      harness.check("the plugin loads without the system prompt service", bare.routes.has("/api/dsh-nextsteps.settings"));
      harness.check("the tool is still registered", bare.tools.has("suggest_followups"));
    }

    const server = await startServer({ port: await freePort() });
    const port = server.port ?? server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const secret = readFileSync(path.join(home, ".dsh", "profiles", "desktop", "dsh-nextsteps", "instance.secret"), "utf8").trim();
    const auth = { [secretHeader]: secret };
    const json = (extra) => ({ [secretHeader]: secret, "content-type": "application/json", ...(extra ?? {}) });

    harness.section("host: boot and instance secret");
    harness.check("the server binds a port", typeof port === "number" && port > 0, String(port));
    harness.check("the secret file lives in the profile", existsSync(path.join(home, ".dsh", "profiles", "desktop", "dsh-nextsteps", "instance.secret")));
    harness.check("the secret is 64 hex characters", /^[0-9a-f]{64}$/.test(secret), secret.slice(0, 12));
    {
      const restarted = await import(`${moduleUrl}?restart=1`);
      const again = await restarted.startServer({ port: await freePort() });
      again.close();
      const reread = readFileSync(path.join(home, ".dsh", "profiles", "desktop", "dsh-nextsteps", "instance.secret"), "utf8").trim();
      harness.check("the secret survives a restart", reread === secret);
    }
    {
      const health = await fetch(`${base}/.ns/health`);
      const body = await health.json();
      harness.check("the health route answers", health.status === 200 && body.ok === true && body.name === "dsh-nextsteps");
    }
    {
      const unauthorized = await fetch(`${base}/.ns/update`);
      harness.eq("a request without the secret is rejected", unauthorized.status, 401);
      const wrong = await fetch(`${base}/.ns/update`, { headers: { [secretHeader]: "0".repeat(64) } });
      harness.eq("a request with a wrong secret is rejected", wrong.status, 401);
      const authorized = await fetch(`${base}/.ns/update`, { headers: { [secretHeader]: secret } });
      harness.eq("a request with the real secret passes the gate", authorized.status, 200);
    }

    harness.section("host: profile directory derivation");
    {
      const fixtureHome = path.join(path.parse(process.cwd()).root, "dsh-profile-fixture-home");
      const fnSource = extractFunction(hostSource, "resolveProfileDir");
      const resolveProfileDir = typeof fnSource === "string"
        ? vm.runInNewContext(`(${fnSource})`, { path })
        : undefined;
      const cases = [
        ["the profile is derived from a web install",
          path.join(fixtureHome, ".dsh", "profiles", "web", "node_modules", "dsh-nextsteps"),
          path.join(fixtureHome, ".dsh", "profiles", "web")],
        ["the profile is derived through the pnpm virtual store",
          path.join(fixtureHome, ".dsh", "profiles", "desktop", "node_modules", ".pnpm", "dsh-nextsteps@1.7.1", "node_modules", "dsh-nextsteps"),
          path.join(fixtureHome, ".dsh", "profiles", "desktop")],
        ["a repository checkout falls back to the desktop profile",
          path.join(fixtureHome, "code", "dsh-nextsteps"),
          path.join(fixtureHome, ".dsh", "profiles", "desktop")],
        ["the innermost profiles segment wins",
          path.join(fixtureHome, "profiles", "outer", ".dsh", "profiles", "inner", "node_modules", "dsh-nextsteps"),
          path.join(fixtureHome, "profiles", "outer", ".dsh", "profiles", "inner")]
      ];
      for (const [name, packageDir, expected] of cases) {
        const actual = typeof resolveProfileDir === "function" ? resolveProfileDir(packageDir, fixtureHome) : undefined;
        harness.eq(name, actual, expected);
      }
    }

    harness.section("host: version and update");
    {
      await withStubbedFetch([
        { match: "registry.npmjs.org/dsh-nextsteps", reply: async () => new Response(JSON.stringify({ version: "99.0.0" }), { status: 200, headers: { "content-type": "application/json" } }) }
      ], async () => {
        const update = await (await fetch(`${base}/.ns/update`, { headers: auth })).json();
        harness.check("the update route answers", update.ok === true && update.update.latest === "v99.0.0" && update.update.newer === true, JSON.stringify(update.update));
      });
      await withStubbedFetch([
        { match: "api.github.com", reply: async () => { throw new Error("the GitHub API must not be asked for the version"); } },
        { match: "registry.npmjs.org/dsh-nextsteps", reply: async () => new Response(JSON.stringify({ version: "99.0.0" }), { status: 200, headers: { "content-type": "application/json" } }) }
      ], async () => {
        const withoutNotes = await (await fetch(`${base}/.ns/update`, { headers: auth })).json();
        harness.check("the version comes from the registry alone", withoutNotes.error === undefined && withoutNotes.update.latest === "v99.0.0", JSON.stringify(withoutNotes).slice(0, 140));
        harness.check("the release is still offered without the notes", withoutNotes.update.newer === true, JSON.stringify(withoutNotes.update).slice(0, 140));
      });
      await withStubbedFetch([
        { match: "registry.npmjs.org/dsh-nextsteps", reply: async () => { throw new Error("This operation was aborted"); } }
      ], async () => {
        const brokenRegistry = await (await fetch(`${base}/.ns/update`, { headers: auth })).json();
        harness.check("a registry failure answers with an error", brokenRegistry.update?.error !== undefined, JSON.stringify(brokenRegistry).slice(0, 140));
      });
      const removed = await fetch(`${base}/.ns/update/install`, { method: "POST", headers: json(), body: JSON.stringify({ version: "9.9.9" }) });
      harness.check("the in-app install route was removed and answers 404", removed.status === 404, `status=${removed.status}`);
      const removedBody = await removed.json();
      harness.check("the removed install route explains itself", removedBody.error === "not found", JSON.stringify(removedBody));
      const running = await (await fetch(`${base}/.ns/update`, { headers: auth })).json();
      harness.check("the running copy is not reported as a pending install", running.update.installed === undefined, JSON.stringify({ installed: running.installed, updateInstalled: running.update.installed }));
    }

    harness.section("host: the in-app install route stays removed");
    {
      const staged = await mkdtemp(path.join(tmpdir(), "dsh-regression-install-"));
      try {
        await writeFile(path.join(staged, "package.json"), JSON.stringify({ name: "dsh-nextsteps", version: pluginVersion }));
        await copyFile(path.join(pluginDir, "index.js"), path.join(staged, "index.js"));
        const installModule = await import(pathToFileURL(path.join(staged, "index.js")).href);
        const installServer = await installModule.startServer({ port: await freePort() });
        const installPort = installServer.port ?? installServer.address().port;
        const installBase = `http://127.0.0.1:${installPort}`;
        try {
          const gone = await fetch(`${installBase}/.ns/update/install`, { method: "POST", headers: { [secretHeader]: secret, "content-type": "application/json" }, body: JSON.stringify({ version: "9.9.9" }) });
          harness.check("the install route answers 404 on a staged server too", gone.status === 404, `status=${gone.status}`);
          const goneBody = await gone.json();
          harness.check("the removed install route explains itself on a staged server", goneBody.error === "not found", JSON.stringify(goneBody));
          const update = await (await fetch(`${installBase}/.ns/update`, { headers: { [secretHeader]: secret } })).json();
          harness.check("the update route keeps answering on a staged server", update.ok === true, JSON.stringify(update).slice(0, 140));
        } finally {
          await installServer.close?.();
        }
      } finally {
        await rm(staged, { recursive: true, force: true });
      }
    }

    harness.section("host: a newer copy on disk waits for the next start");
    {
      const [newerMajor] = pluginVersion.split(".");
      const newerVersion = `${Number(newerMajor) + 1}.0.0`;
      const staged = await mkdtemp(path.join(tmpdir(), "dsh-regression-newer-"));
      try {
        await writeFile(path.join(staged, "package.json"), JSON.stringify({ name: "dsh-nextsteps", version: newerVersion }));
        await copyFile(path.join(pluginDir, "index.js"), path.join(staged, "index.js"));
        const stagedUrl = pathToFileURL(path.join(staged, "index.js")).href;
        const stagedModule = await import(stagedUrl);
        const newerServer = await stagedModule.startServer({ port: await freePort() });
        const newerPort = newerServer.port ?? newerServer.address().port;
        const newerBase = `http://127.0.0.1:${newerPort}`;
        const newerAuth = { [secretHeader]: secret };
        try {
          const newerUpdate = await (await fetch(`${newerBase}/.ns/update`, { headers: newerAuth })).json();
          harness.eq("the update route reports the newer copy as installed", newerUpdate.update.installed, newerVersion);
          harness.eq("the running copy is still the one that runs", newerUpdate.version, pluginVersion);
        } finally {
          newerServer.close();
        }
      } finally {
        await rm(staged, { recursive: true, force: true });
      }
    }

    harness.section("host: the secret route is registered");
    {
      const secretRoute = host.routes.get("/api/dsh-nextsteps.secret");
      harness.check("the secret route is registered", host.routes.has("/api/dsh-nextsteps.secret"));
      harness.eq("the secret route declares GET", secretRoute.methods, ["GET"]);
      harness.eq("the secret route buffers the body", secretRoute.requestBody, "buffered");
      const secretBody = await (await secretRoute.fetch(new Request("http://x/api/dsh-nextsteps.secret"))).json();
      harness.check("the secret route hands the instance secret over", secretBody.ok === true && secretBody.secret === secret);
    }

    await server.close?.();

    harness.section("host: the four new settings are loaded, validated and persisted");
    {
      const route = host.routes.get("/api/dsh-nextsteps.settings");
      const defaults = (await (await route.fetch(new Request("http://x/api/dsh-nextsteps.settings"))).json()).settings;
      harness.eq("the styles default to the three angles", defaults.styles, ["next-action", "explore", "deep-dive"]);
      harness.eq("the generation mode defaults to auto", defaults.generationMode, "auto");
      harness.eq("the latency budget defaults to sixty seconds", defaults.latencyBudgetMs, 60000);
      harness.eq("the suggestion length defaults to two hundred", defaults.maxSuggestionChars, 200);

      const accepted = await (await route.fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ styles: ["explore", "deep-dive"], generationMode: "on-demand", latencyBudgetMs: 45000, maxSuggestionChars: 320 })
      }))).json();
      harness.eq("the styles are persisted", accepted.settings.styles, ["explore", "deep-dive"]);
      harness.eq("the generation mode is persisted", accepted.settings.generationMode, "on-demand");
      harness.eq("the latency budget is persisted", accepted.settings.latencyBudgetMs, 45000);
      harness.eq("the suggestion length is persisted", accepted.settings.maxSuggestionChars, 320);

      const stored = JSON.parse(readFileSync(settingsFile, "utf8"));
      harness.eq("the styles reach the disk", stored.styles, ["explore", "deep-dive"]);
      harness.eq("the generation mode reaches the disk", stored.generationMode, "on-demand");
      harness.eq("the latency budget reaches the disk", stored.latencyBudgetMs, 45000);
      harness.eq("the suggestion length reaches the disk", stored.maxSuggestionChars, 320);

      const invalid = await (await route.fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ styles: ["not-a-style"], generationMode: "whenever", latencyBudgetMs: 10, maxSuggestionChars: 9000 })
      }))).json();
      harness.eq("an unknown style keeps the current styles", invalid.settings.styles, ["explore", "deep-dive"]);
      harness.eq("an unknown generation mode keeps the current one", invalid.settings.generationMode, "on-demand");
      harness.eq("a budget below the floor keeps the current one", invalid.settings.latencyBudgetMs, 45000);
      harness.eq("a length above the ceiling keeps the current one", invalid.settings.maxSuggestionChars, 320);

      const duplicated = await (await route.fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ styles: ["explore", "explore"] })
      }))).json();
      harness.eq("a duplicated style is stored once", duplicated.settings.styles, ["explore"]);

      const emptied = await (await route.fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ styles: [] })
      }))).json();
      harness.eq("an empty style selection keeps the current styles", emptied.settings.styles, ["explore"]);

      await route.fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ styles: ["next-action", "explore", "deep-dive"], generationMode: "auto", latencyBudgetMs: 60000, maxSuggestionChars: 200 })
      }));
    }

    harness.section("host: the style and the length rule reach the model facing surfaces");
    {
      const route = host.routes.get("/api/dsh-nextsteps.settings");
      await route.fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "auto", model: "", styles: ["explore"], maxSuggestionChars: 120 })
      }));

      const inline = section.text();
      harness.includes("the inline section carries the style rule", inline, "Vary the suggestions across these angles");
      harness.includes("the inline section names the chosen angle", inline, "a different direction worth exploring");
      harness.excludes("the inline section does not carry an unchosen angle", inline, "the next concrete action to take");
      harness.includes("the inline section carries the length rule", inline, "Each prompt is at most 120 characters.");

      llm.calls.length = 0;
      const generateRoute = host.routes.get("/api/dsh-nextsteps.generate");
      await (await generateRoute.fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }))).json();
      const generator = llm.calls.at(-1)?.system ?? "";
      harness.includes("the generator carries the style rule", generator, "Vary the suggestions across these angles");
      harness.includes("the generator names the chosen angle", generator, "a different direction worth exploring");
      harness.excludes("the generator does not carry an unchosen angle", generator, "the next concrete action to take");
      harness.includes("the generator carries the length rule", generator, "Each prompt is at most 120 characters.");

      const rewriteEvents = [
        { seq: 1, type: "user/message", data: { source: { kind: "user" }, content: "corrija o parser" } },
        { seq: 2, type: "tool/call", data: { turn: 1, step: 1, callId: "call-style", name: "suggest_followups", arguments: "{}" } },
        { seq: 3, type: "assistant/message", data: { message: { content: [{ type: "text", text: "done" }] } } },
        { seq: 12, type: "turn/end", data: { reason: { kind: "completed" } } }
      ];
      host.setService("sessionQuery", fakeSessionQuery(rewriteEvents));
      const rewriteLlm = fakeLlm({ text: JSON.stringify({ followups: [{ prompt: "Rodar os testes", label: "Testes" }] }) });
      host.setService("llm", rewriteLlm);
      await route.fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "pt-BR", model: "" })
      }));
      await host.tools.get("suggest_followups").execute({ followups: [{ prompt: "Run tests", label: "Tests" }] }, { callId: "call-style", agent: { id: "session-1" } });
      await (await generateRoute.fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }))).json();
      const rewrite = rewriteLlm.calls.at(-1)?.system ?? "";
      harness.excludes("the rewrite prompt carries no style rule", rewrite, "Vary the suggestions across these angles");
      harness.excludes("the rewrite prompt carries no length rule", rewrite, "Each prompt is at most");
      host.setService("llm", llm);
      host.setService("sessionQuery", fakeSessionQuery(turnEvents(12)));
    }

    harness.section("host: the transcript is capped and the last line survives");
    {
      const settingsRoute = host.routes.get("/api/dsh-nextsteps.settings");
      const generateRoute = host.routes.get("/api/dsh-nextsteps.generate");
      await settingsRoute.fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "auto", model: "", maxSuggestionChars: 60 })
      }));
      const long = "x".repeat(4000);
      const events = [
        { seq: 1, type: "user/message", data: { source: { kind: "user" }, content: `${long} first` } },
        { seq: 2, type: "assistant/message", data: { message: { content: [{ type: "text", text: `${long} second` }] } } },
        { seq: 3, type: "user/message", data: { source: { kind: "user" }, content: "the last question" } },
        { seq: 4, type: "assistant/message", data: { message: { content: [{ type: "text", text: "the last answer" }] } } },
        { seq: 12, type: "turn/end", data: { reason: { kind: "completed" } } }
      ];
      host.setService("sessionQuery", fakeSessionQuery(events));
      llm.calls.length = 0;
      await (await generateRoute.fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }))).json();
      const transcript = llm.calls.at(-1)?.messages?.[0]?.content?.[0]?.text ?? "";
      const budget = 60 * 40;
      const body = transcript.slice(transcript.indexOf("<transcript>") + "<transcript>".length, transcript.lastIndexOf("</transcript>")).trim();
      harness.check("the transcript respects the budget", body.length <= budget, `${body.length} > ${budget}`);
      harness.includes("the transcript keeps the last line", body, "the last answer");
      harness.excludes("the transcript dropped the oldest line", body, "first");
      host.setService("sessionQuery", fakeSessionQuery(turnEvents(12)));
    }

    harness.section("host: the generator honours the length and the latency budget");
    {
      const settingsRoute = host.routes.get("/api/dsh-nextsteps.settings");
      const generateRoute = host.routes.get("/api/dsh-nextsteps.generate");
      const long = "y".repeat(500);
      host.setService("llm", fakeLlm({ text: JSON.stringify({ followups: [{ prompt: long, label: "L" }] }) }));
      await settingsRoute.fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: "auto", model: "", maxSuggestionChars: 90 })
      }));
      const body = await (await generateRoute.fetch(new Request("http://x/api/dsh-nextsteps.generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
      }))).json();
      harness.eq("the prompt is truncated to the configured length", body.followups[0]?.prompt.length, 90);

      await settingsRoute.fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ latencyBudgetMs: 7000 })
      }));
      llm.calls.length = 0;
      const deadlines = [];
      const originalTimeout = AbortSignal.timeout;
      AbortSignal.timeout = (ms) => {
        deadlines.push(ms);
        return originalTimeout(ms);
      };
      try {
        await (await generateRoute.fetch(new Request("http://x/api/dsh-nextsteps.generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "session-1", afterSeq: 12 })
        }))).json();
      } finally {
        AbortSignal.timeout = originalTimeout;
      }
      harness.check("the generation arms one deadline", deadlines.length === 1, JSON.stringify(deadlines));
      harness.eq("the deadline is the latency budget", deadlines[0], 7000);
      host.setService("llm", llm);
      await settingsRoute.fetch(new Request("http://x/api/dsh-nextsteps.settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxSuggestionChars: 200, latencyBudgetMs: 60000 })
      }));
    }

    const singleton = await startServer();
    singleton.close();
  });
}
