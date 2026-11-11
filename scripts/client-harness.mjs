import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A React-shaped stub good enough to render the plugin's function components. */
export function fakeReact() {
  const stores = new Map();
  const effects = [];
  let active = null;
  let cursor = 0;
  const storeFor = () => {
    let store = stores.get(active);
    if (store === undefined) {
      store = [];
      stores.set(active, store);
    }
    return store;
  };
  const hooks = {
    useState(initial) {
      const state = storeFor();
      const index = cursor++;
      if (state.length <= index) state[index] = typeof initial === "function" ? initial() : initial;
      const setValue = (next) => {
        state[index] = typeof next === "function" ? next(state[index]) : next;
      };
      return [state[index], setValue];
    },
    useReducer(reducer, initial) {
      const state = storeFor();
      const index = cursor++;
      if (state.length <= index) state[index] = initial;
      const dispatch = (action) => {
        state[index] = reducer(state[index], action);
      };
      return [state[index], dispatch];
    },
    useRef(initial) {
      const state = storeFor();
      const index = cursor++;
      if (state.length <= index) state[index] = { current: initial };
      return state[index];
    },
    useMemo(factory) {
      return factory();
    },
    useCallback(fn) {
      return fn;
    },
    useEffect(effect) {
      effects.push(effect);
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      return getSnapshot();
    }
  };
  const createElement = (type, props, ...children) => {
    const flat = [];
    const push = (child) => {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) {
        for (const item of child) push(item);
        return;
      }
      flat.push(child);
    };
    for (const child of children) push(child);
    return { type, props: props ?? {}, children: flat };
  };
  return {
    ...hooks,
    createElement,
    __reset: () => { cursor = 0; effects.length = 0; },
    __setComponent: (component) => { active = component; },
    __effects: effects
  };
}

export function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
    _data: data
  };
}

/**
 * Loads client.js the way the dsh module loader does and returns the plugin instance.
 * The client is a browser bundle: it is evaluated with a fake window/document and the
 * captured factory is invoked with a `require` that hands out the fake React.
 */
export function loadClient({ storage = memoryStorage(), language = "en", routes = {} } = {}) {
  const source = readFileSync(path.join(root, "client.js"), "utf8");
  let captured;
  const head = { appendChild() {} };
  const document = {
    head,
    createElement: () => ({ style: {}, set textContent(value) { this._text = value; }, appendChild() {} })
  };
  const window = {
    localStorage: storage,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id)
  };
  const loader = { load: (module) => { captured = module; } };
  window.__ModuleLoader__ = loader;
  const evaluate = new Function("window", "document", "navigator", "console", source);
  evaluate(window, document, { language }, console);
  if (captured === undefined) throw new Error("client.js did not register a module");
  const react = fakeReact();
  const fetchStub = stubFetch(routes);
  const instance = captured.factory((name) => {
    if (name === "react") return react;
    if (name === "react-dom") return { createPortal: (node) => node };
    throw new Error(`the client requires an unexpected module: ${name}`);
  });
  return { instance, react, storage, window, document, moduleId: captured.id, fetchStub };
}

/** Collects the slot registrations a plugin performs, so a test can render a component. */
export function fakeSlotHost(react) {
  const registrations = [];
  const dictionaries = new Map();
  const wrap = (component) => {
    if (typeof component !== "function") return component;
    return (props) => {
      react?.__setComponent?.(component);
      react?.__reset?.();
      return component(props);
    };
  };
  const ctx = {
    slots: {
      inject: (name, register) => {
        const value = register();
        registrations.push({ name, value });
        return value;
      },
      register: (spec, component) => {
        registrations.push({ name: spec.name, spec, component: wrap(component) });
        return component;
      }
    },
    locale: {
      register: (namespace, code, dictionary) => {
        dictionaries.set(`${namespace}/${code}`, dictionary);
        return () => {};
      },
      bind: (namespace) => (key) => {
        for (const [id, dictionary] of dictionaries) {
          if (id.startsWith(`${namespace}/`) && typeof dictionary[key] === "string") return dictionary[key];
        }
        return key;
      }
    },
    effect: (fn) => {
      try {
        return fn();
      } catch {
        return undefined;
      }
    },
    get: () => undefined
  };
  return { ctx, registrations, dictionaries };
}

/**
 * Stubs the browser fetch the client uses for the host routes, so the client can
 * exercise its settings and model catalog paths without a dsh host.
 */
export function stubFetch(routes = {}) {
  const calls = [];
  const original = globalThis.fetch;
  const table = new Map(Object.entries(routes));
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    const handler = table.get(url);
    if (handler === undefined) {
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }
    const answer = typeof handler === "function" ? await handler(init) : handler;
    const body = typeof answer === "string" ? answer : JSON.stringify(answer);
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  };
  return {
    calls,
    set: (url, handler) => table.set(url, handler),
    restore: () => {
      globalThis.fetch = original;
    }
  };
}

/** Walks a rendered element tree and returns every node matching the predicate. */
export function walk(node, predicate, found = []) {
  if (node === null || node === undefined || typeof node === "boolean") return found;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, predicate, found);
    return found;
  }
  if (typeof node !== "object") return found;
  if (predicate(node)) found.push(node);
  for (const child of node.children ?? []) walk(child, predicate, found);
  return found;
}

export function textOf(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((item) => textOf(item)).join(" ");
  return (node.children ?? []).map((item) => textOf(item)).join(" ");
}

export { root };
