import { suite, test, assert, assertEqual } from "../harness.mjs";
import { loadClient, fakeSlotHost, walk, textOf } from "../client-harness.mjs";

suite("i18n: the inline dictionary factory");

function factory() {
  const client = loadClient();
  const { ctx } = fakeSlotHost(client.react);
  client.instance.apply(ctx);
  const api = client.instance;
  assert(api.i18n !== undefined, "apply exposes the i18n factory");
  return api;
}

test("apply exposes an i18n object with register and fallback", () => {
  const api = factory();
  assertEqual(typeof api.i18n.register, "function", "i18n.register is a function");
  assertEqual(typeof api.i18n.fallback, "function", "i18n.fallback is a function");
});

test("i18n.register registers exactly en, pt-BR and zh-CN with exact effect names", () => {
  const api = factory();
  const dictionaries = new Map();
  const names = [];
  const ctx = {
    effect: (fn, name) => {
      names.push(name);
      return fn();
    },
    locale: {
      register: (ns, code, dictionary) => {
        dictionaries.set(`${ns}/${code}`, dictionary);
        return () => {};
      }
    }
  };
  api.i18n.register(ctx);
  assertEqual([...dictionaries.keys()], ["dsh-nextsteps/en", "dsh-nextsteps/pt-BR", "dsh-nextsteps/zh-CN"], "the three dictionaries register under the plugin namespace");
  assertEqual(names, [
    "dsh-nextsteps: en dictionary",
    "dsh-nextsteps: pt-BR dictionary",
    "dsh-nextsteps: zh-CN dictionary"
  ], "the effect names are exact");
});

test("i18n.fallback returns the key when no dictionary carries it", () => {
  const api = factory();
  const key = "__i18n_no_such_key_9f31c2__";
  assertEqual(api.i18n.fallback(key), key, "an unknown key is returned unchanged");
});

test("i18n.fallback uses the en table for a real key", () => {
  const api = factory();
  assertEqual(api.i18n.fallback("header"), "Suggested followups", "the en value is the fallback");
});

test("the settings section uses en strings when locale.bind throws", () => {
  const client = loadClient();
  const { ctx, registrations } = fakeSlotHost(client.react);
  ctx.locale.bind = () => {
    throw new Error("locale bind unavailable");
  };
  client.instance.apply(ctx);
  const settings = registrations.find((entry) => entry.spec?.name === "settings.section");
  assert(settings !== undefined, "the settings section is registered");
  const tree = settings.component({});
  const languageSelects = walk(tree, (node) => node.type === "select" && node.props?.["aria-label"] === "Language");
  assertEqual(languageSelects.length, 1, "the language select carries the en label 'Language'");
  assert(textOf(tree).includes("Suggested next-step prompts under every finished agent turn"), "the settings intro is rendered in en");
});

test("a refused dictionary reports the exact warn message", () => {
  const realWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args.map((arg) => String(arg)));
  };
  try {
    const api = factory();
    const ctx = {
      effect: (fn) => fn(),
      locale: {
        register: () => {
          throw new Error("refused");
        }
      }
    };
    api.i18n.register(ctx);
    const reports = warnings.filter((args) => typeof args[0] === "string" && args[0].includes("dictionary was not accepted by the locale service"));
    assertEqual(reports.length, 3, "each refused dictionary is reported once");
    assertEqual(reports[0][0], "dsh-nextsteps: en dictionary was not accepted by the locale service:", "the warn message is exact");
  } finally {
    console.warn = realWarn;
  }
});
