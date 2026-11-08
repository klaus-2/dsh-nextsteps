import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";

export function createHarness({ title }) {
  const results = [];
  let section = "";
  const harness = {
    section(name) {
      section = name;
      process.stdout.write(`\n-- ${name} ${"-".repeat(Math.max(3, 60 - name.length))}\n`);
    },
    check(name, condition, detail = "") {
      const ok = Boolean(condition);
      results.push({ section, name, ok, detail });
      process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : ` -- ${detail}`}\n`);
      return ok;
    },
    eq(name, actual, expected) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      return harness.check(name, a === b, a === b ? "" : `got ${a}, want ${b}`);
    },
    includes(name, haystack, needle) {
      const ok = typeof haystack === "string" && haystack.includes(needle);
      return harness.check(name, ok, ok ? "" : `missing ${JSON.stringify(needle)}`);
    },
    excludes(name, haystack, needle) {
      const ok = typeof haystack === "string" && !haystack.includes(needle);
      return harness.check(name, ok, ok ? "" : `unexpected ${JSON.stringify(needle)}`);
    },
    skip(name, reason = "") {
      results.push({ section, name, ok: true, detail: "", skipped: true });
      process.stdout.write(`SKIP  ${name}${reason === "" ? "" : ` -- ${reason}`}\n`);
      return true;
    },
    report() {
      const failed = results.filter((entry) => !entry.ok);
      const skipped = results.filter((entry) => entry.skipped === true);
      process.stdout.write(`\n${"=".repeat(62)}\n`);
      process.stdout.write(`${title}: ${results.length - failed.length - skipped.length}/${results.length - skipped.length} checks passed${skipped.length > 0 ? `, ${skipped.length} skipped` : ""}\n`);
      if (failed.length > 0) {
        process.stdout.write(`\n${failed.length} FAILURE(S):\n`);
        for (const failure of failed) {
          process.stdout.write(`  x [${failure.section}] ${failure.name}${failure.detail === "" ? "" : ` -- ${failure.detail}`}\n`);
        }
      }
      return failed.length === 0 ? 0 : 1;
    },
    results
  };
  return harness;
}

export async function withIsolatedHome(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "dsh-regression-"));
  const previousProfile = process.env.USERPROFILE;
  const previousHome = process.env.HOME;
  process.env.USERPROFILE = dir;
  process.env.HOME = dir;
  try {
    return await run(dir);
  } finally {
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(dir, { recursive: true, force: true });
  }
}

export function fakeHostCtx(services = {}) {
  const tools = new Map();
  const routes = new Map();
  const sections = [];
  const commands = new Map();
  const listeners = new Map();
  const injects = [];
  const resolved = { ...services };
  const toolsService = {
    register(spec) {
      tools.set(spec.name, spec);
      return () => tools.delete(spec.name);
    },
    unregister(name) {
      tools.delete(name);
    }
  };
  const systemPromptService = {
    section(spec) {
      sections.push(spec);
      return () => {};
    }
  };
  if (resolved.systemPrompt === undefined) resolved.systemPrompt = systemPromptService;
  const ctx = {
    get(name) {
      return resolved[name];
    },
    tools: toolsService,
    systemPrompt: systemPromptService,
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route);
          return () => routes.delete(route.path);
        }
      }
    },
    commands: {
      register(spec) {
        commands.set(spec.name, spec);
        return () => commands.delete(spec.name);
      }
    },
    agents: {},
    attachments: {
      saveImage: async ({ data, mediaType }) => ({ id: "attachment-1", mediaType, size: data?.length ?? 0 })
    },
    on(event, handler) {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    },
    logger: { info() {}, warn() {}, error() {} },
    inject(deps, callback) {
      injects.push({ deps, callback });
    }
  };
  return {
    ctx,
    tools,
    routes,
    sections,
    commands,
    listeners,
    injects,
    services: resolved,
    setService(name, value) {
      resolved[name] = value;
    },
    runInject(names) {
      const entry = injects.find((candidate) => names.every((name) => candidate.deps.includes(name)));
      if (entry === undefined) return undefined;
      const accessed = new Set();
      const named = { tools: toolsService, systemPrompt: systemPromptService };
      const proxied = new Proxy(named, {
        get(target, property) {
          if (typeof property === "string") accessed.add(property);
          return target[property];
        }
      });
      const result = entry.callback(proxied);
      return { result, accessed };
    }
  };
}

export function fakeClientCtx(overrides = {}) {
  const slots = [];
  const injected = [];
  const locale = [];
  const effects = [];
  const services = { styles: { insert() {} }, ...overrides };
  const ctx = {
    get(name) {
      return services[name];
    },
    slots: {
      inject(name, fn) {
        injected.push({ name, fn });
      },
      register(spec, component) {
        slots.push({ spec, component });
        return () => {};
      }
    },
    locale: {
      register(namespace, code, dictionary) {
        locale.push({ namespace, code, dictionary });
      },
      bind() {
        return (key) => key;
      }
    },
    effect(fn, label) {
      effects.push({ fn, label });
      return () => {};
    },
    remote: { get: async () => undefined }
  };
  const api = {
    ctx,
    slots,
    injected,
    locale,
    effects,
    services,
    resolve() {
      for (const effect of effects) effect.fn();
      for (const entry of injected) entry.fn();
      return api;
    }
  };
  return api;
}

export function createReactStub() {
  let cursor = 0;
  let current = null;
  const stores = new Map();
  let effects = [];
  const storeFor = (component) => {
    let store = stores.get(component);
    if (store === undefined) {
      store = [];
      stores.set(component, store);
    }
    return store;
  };
  const React = {
    createElement(type, props, ...children) {
      const merged = { ...(props ?? {}) };
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      return { $$element: true, type, props: merged };
    },
    useState(initial) {
      const store = storeFor(current);
      const index = cursor;
      cursor += 1;
      if (store.length <= index) store[index] = typeof initial === "function" ? initial() : initial;
      const setState = (next) => {
        store[index] = typeof next === "function" ? next(store[index]) : next;
      };
      return [store[index], setState];
    },
    useReducer(reducer, initial) {
      const store = storeFor(current);
      const index = cursor;
      cursor += 1;
      if (store.length <= index) store[index] = initial;
      const dispatch = (action) => {
        store[index] = reducer(store[index], action);
      };
      return [store[index], dispatch];
    },
    useRef(initial) {
      const store = storeFor(current);
      const index = cursor;
      cursor += 1;
      if (store.length <= index) store[index] = { current: initial };
      return store[index];
    },
    useEffect(effect, deps) {
      effects.push({ effect, deps });
    },
    useCallback(callback) {
      return callback;
    },
    useMemo(factory) {
      return factory();
    },
    Fragment: "Fragment"
  };
  return {
    React,
    beginRender(component) {
      current = component ?? current;
      cursor = 0;
      effects = [];
    },
    getEffects() {
      return effects;
    },
    getStates() {
      return storeFor(current);
    }
  };
}

export function renderOnce(stub, Component, props = {}) {
  stub.beginRender(Component);
  const tree = Component(props);
  return { tree, effects: stub.getEffects().map((entry) => entry.effect), states: stub.getStates() };
}

export function walkTree(node, visit) {
  if (node === null || node === undefined) return;
  if (typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkTree(child, visit);
    return;
  }
  if (node.$$element !== true) return;
  visit(node);
  walkTree(node.props?.children, visit);
}

export function findElements(tree, predicate) {
  const found = [];
  walkTree(tree, (element) => {
    if (predicate(element)) found.push(element);
  });
  return found;
}

export function findByText(tree, text) {
  return findElements(tree, (element) => typeof element.props?.children === "string" && element.props.children.includes(text));
}

export function findByClass(tree, className) {
  return findElements(tree, (element) => typeof element.props?.className === "string" && element.props.className.split(/\s+/).includes(className));
}

export async function click(element) {
  if (typeof element?.props?.onClick !== "function") throw new Error("element has no onClick handler");
  return element.props.onClick();
}

export async function flush(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

export function makeLocalStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
    dump() {
      return Object.fromEntries(map);
    }
  };
}

export function loadClientModule(file, options = {}) {
  const source = readFileSync(file, "utf8");
  let loaded = null;
  const localStorage = options.localStorage ?? makeLocalStorage();
  const windowStub = {
    __ModuleLoader__: {
      load(spec) {
        loaded = spec;
      }
    },
    localStorage,
    setTimeout: options.setTimeout ?? setTimeout,
    clearTimeout: options.clearTimeout ?? clearTimeout,
    ...(options.window ?? {})
  };
  const sandbox = {
    window: windowStub,
    document: options.document ?? {
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {}
    },
    console: options.console ?? { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    fetch: options.fetch ?? (async () => { throw new Error("fetch was not stubbed"); }),
    localStorage,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    AbortController,
    AbortSignal,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    structuredClone: globalThis.structuredClone,
    ...(options.sandbox ?? {})
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: file });
  if (loaded === null) throw new Error(`${file} never called window.__ModuleLoader__.load`);
  const module = loaded.factory((name) => {
    if (name === "react") {
      if (options.react === undefined) throw new Error(`${file} requires react but no stub was provided`);
      return options.react;
    }
    throw new Error(`unexpected require("${name}") in ${file}`);
  });
  return { spec: loaded, module, window: windowStub, sandbox };
}

export function extractObjectLiteral(source, marker) {
  const anchor = source.indexOf(marker);
  if (anchor === -1) return undefined;
  const start = source.indexOf("{", anchor);
  if (start === -1) return undefined;
  let depth = 0;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== "") {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return undefined;
}

export function evaluateObjectLiteral(text, filename = "literal") {
  if (text === undefined) return undefined;
  return vm.runInNewContext(`(${text})`, { t: (key) => key }, { filename });
}

export function evaluateExpression(text, filename = "expression") {
  if (text === undefined) return undefined;
  return vm.runInNewContext(`(${text})`, { t: (key) => key }, { filename });
}

export function collectCallArguments(source, callee) {
  const calls = [];
  const needle = `${callee}(`;
  let index = source.indexOf(needle);
  while (index !== -1) {
    const open = index + needle.length - 1;
    let depth = 0;
    let quote = "";
    let end = open;
    for (let cursor = open; cursor < source.length; cursor += 1) {
      const char = source[cursor];
      if (quote !== "") {
        if (char === "\\") {
          cursor += 1;
          continue;
        }
        if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }
    calls.push(source.slice(open + 1, end));
    index = source.indexOf(needle, end + 1);
  }
  return calls;
}

export async function withStubbedFetch(rules, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    for (const rule of rules) {
      if (url.includes(rule.match)) return rule.reply(url, init);
    }
    return original(input, init);
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

export async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
