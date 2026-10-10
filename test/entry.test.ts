/**
 * Fake-pi entry test: proves the wiring in `index.ts` without a real pi process.
 *
 * Three things only this layer can prove:
 *  1. the extension registers exactly one provider, on the surface the env var
 *     asks for, and constructs only that adapter;
 *  2. the hook set is exactly the intended one, and the single
 *     `before_provider_request` handler does one thing (inject `prompt_cache_key`
 *     on chat payloads for this provider) and nothing else. This test used to
 *     assert the hook's ABSENCE — that was the measured answer on 2026-10-11 at
 *     build time; the cache-routing measurement later the same day reopened it and
 *     the flip changed this test, the wire test and the README together;
 *  3. the two error layers behave under pi's real sequencing: `message_end`,
 *     then pi's IN-PLACE replacement of the stored message, then `turn_end` —
 *     which is why the persistent-entry predicates must recognize our own
 *     rewrite (pitfalls P51), and why the entry is gated on `ctx.hasUI`
 *     (appending an entry after the errored assistant message makes `pi -p`
 *     print nothing at all).
 */
import assert from "node:assert/strict";
import test, { describe, beforeEach } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Handler = (event: any, ctx?: any) => any;

interface FakePi {
  registered: any[];
  commands: Record<string, any>;
  handlers: Map<string, Handler[]>;
  registerProvider: (p: any) => void;
  registerCommand: (name: string, c: any) => void;
  registerTool: () => void;
  on: (event: string, handler: Handler) => () => void;
  emit: (event: string, payload?: any, ctx?: any) => any;
}

function fakePi(): FakePi {
  const pi: FakePi = {
    registered: [],
    commands: {},
    handlers: new Map<string, Handler[]>(),
    registerProvider: (p) => { pi.registered.push(p); },
    registerCommand: (name, c) => { pi.commands[name] = c; },
    registerTool: () => {},
    on(event, handler) {
      const list = pi.handlers.get(event) ?? [];
      list.push(handler);
      pi.handlers.set(event, list);
      return () => pi.handlers.set(event, list.filter((h) => h !== handler));
    },
    emit(event, payload, ctx) {
      let result;
      for (const handler of pi.handlers.get(event) ?? []) result = handler(payload, ctx) ?? result;
      return result;
    },
  };
  return pi;
}

/** pi's `_replaceMessageInPlace`: mutate the stored object, keep its identity. */
function replaceInPlace(target: Record<string, unknown>, replacement: Record<string, unknown>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, replacement);
}

function errorStop(errorMessage: string, provider = "longcat") {
  return { role: "assistant", stopReason: "error", provider, errorMessage, content: [] };
}

/** message_end → in-place replacement → turn_end, exactly as pi sequences them. */
function runTurn(pi: FakePi, rawErrorMessage: string, opts: { hasUI?: boolean; entries?: unknown[]; provider?: string } = {}) {
  const { hasUI = true, entries = [], provider = "longcat" } = opts;
  const message = errorStop(rawErrorMessage, provider) as unknown as Record<string, unknown>;
  const endResult = pi.emit("message_end", { message });
  if (endResult?.message) replaceInPlace(message, endResult.message as Record<string, unknown>);
  const turnResult = pi.emit("turn_end", { outcome: "error", message, entries }, { hasUI });
  return { message, turnResult };
}

const UI_CTX = (notified: string[]) =>
  ({ hasUI: true, ui: { notify: (msg: string) => { notified.push(msg); } } }) as any;

/** Fresh HOME + no ambient provider env, then import and run the extension. */
async function load(env: Record<string, string | undefined> = {}) {
  const home = mkdtempSync(join(tmpdir(), "pi-longcat-entry-"));
  const saved: Record<string, string | undefined> = {};
  for (const name of ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR", "LONGCAT_API_KEY", "LONGCAT_SURFACE", "LONGCAT_BASE_URL", "LONGCAT_CNY_PER_USD"]) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  // A deliberate space in the agent dir: path-quoting bugs show up here.
  process.env.HOME = home;
  process.env.PI_CODING_AGENT_DIR = join(home, "custom agent dir");
  for (const [name, value] of Object.entries(env)) if (value !== undefined) process.env[name] = value;
  const notified: string[] = [];
  try {
    const pi = fakePi();
    const mod = await import(`../index.ts?run=${encodeURIComponent(JSON.stringify(env))}`);
    await mod.default(pi as any);
    return { pi, notified, home, restore: () => {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    } };
  } catch (e) {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    throw e;
  }
}

describe("registration", () => {
  let loaded: Awaited<ReturnType<typeof load>>;
  beforeEach(() => { loaded?.restore(); });

  test("registers exactly one provider, id longcat, on the default chat surface", async () => {
    loaded = await load();
    try {
      assert.equal(loaded.pi.registered.length, 1);
      const provider = loaded.pi.registered[0];
      assert.equal(provider.id, "longcat");
      assert.deepEqual(provider.getModels().map((m: any) => m.api), ["openai-completions", "openai-completions"]);
      assert.deepEqual(provider.getModels().map((m: any) => m.id), ["LongCat-2.5-Preview", "LongCat-2.0"]);
    } finally { loaded.restore(); }
  });

  test("LONGCAT_SURFACE=responses registers the Responses surface only", async () => {
    loaded = await load({ LONGCAT_SURFACE: "responses" });
    try {
      const provider = loaded.pi.registered[0];
      assert.deepEqual(provider.getModels().map((m: any) => m.api), ["openai-responses", "openai-responses"]);
      assert.equal(provider.getModels().length, 2, "one surface per process: 2 ids, not 4");
    } finally { loaded.restore(); }
  });

  test("an unrecognized surface still registers the default, and warns once the UI exists", async () => {
    loaded = await load({ LONGCAT_SURFACE: "respones" });
    try {
      const provider = loaded.pi.registered[0];
      assert.deepEqual(provider.getModels().map((m: any) => m.api), ["openai-completions", "openai-completions"]);
      assert.equal(loaded.pi.handlers.get("session_start")?.length, 1, "a typo must not pass silently (P52)");
      loaded.pi.emit("session_start", {}, UI_CTX(loaded.notified));
      assert.equal(loaded.notified.length, 1);
      assert.match(loaded.notified[0]!, /LONGCAT_SURFACE=respones was not applied/);
      assert.match(loaded.notified[0]!, /unknown value/);
      // Print/json mode must stay silent: a notice there can corrupt output.
      loaded.pi.emit("session_start", {}, { hasUI: false, ui: { notify: () => { throw new Error("must not notify"); } } });
      assert.equal(loaded.notified.length, 1);
    } finally { loaded.restore(); }
  });

  test("asking for the Anthropic surface explains why it is unavailable", async () => {
    loaded = await load({ LONGCAT_SURFACE: "anthropic" });
    try {
      loaded.pi.emit("session_start", {}, UI_CTX(loaded.notified));
      assert.match(loaded.notified[0] ?? "", /x-api-key/);
      assert.match(loaded.notified[0] ?? "", /401 missing_api_key/);
      assert.deepEqual(loaded.pi.registered[0].getModels().map((m: any) => m.api), ["openai-completions", "openai-completions"]);
    } finally { loaded.restore(); }
  });

  test("a valid surface request registers no warning handler", async () => {
    loaded = await load({ LONGCAT_SURFACE: "chat" });
    try {
      assert.equal(loaded.pi.handlers.get("session_start")?.length ?? 0, 0);
    } finally { loaded.restore(); }
  });

  test("the hook set is exactly the three intended events, and no commands", async () => {
    loaded = await load();
    try {
      const events = [...loaded.pi.handlers.keys()].sort();
      assert.deepEqual(events, ["before_provider_request", "message_end", "turn_end"]);
      assert.equal(loaded.pi.handlers.get("before_provider_request")?.length, 1, "exactly one payload handler");
      assert.deepEqual(Object.keys(loaded.pi.commands), [], "no commands: this plugin is a provider, not a UI");
    } finally { loaded.restore(); }
  });

  test("does not create a stray agent dir of its own", async () => {
    loaded = await load();
    try {
      assert.equal(loaded.pi.registered.length, 1);
      // PI_CODING_AGENT_DIR contains a space on purpose; nothing may have
      // re-created ~/.pi/agent behind pi's back.
      assert.ok(process.env.PI_CODING_AGENT_DIR?.includes("custom agent dir"));
    } finally { loaded.restore(); }
  });
});

describe("the prompt_cache_key hook (added 2026-10-11 after the cache-routing measurement)", () => {
  let loaded: Awaited<ReturnType<typeof load>>;
  beforeEach(() => { loaded?.restore(); });

  const chatPayload = () => ({
    model: "LongCat-2.0",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 16,
    thinking: { type: "disabled" },
  });
  const ctxFor = (api: string, sessionId: string | undefined, provider = "longcat") =>
    ({ model: { provider, api }, sessionManager: sessionId === undefined ? undefined : { getSessionId: () => sessionId } }) as any;

  test("injects the clamped session id into a chat payload for this provider", async () => {
    loaded = await load();
    try {
      const before: Record<string, unknown> = chatPayload();
      const result = loaded.pi.emit("before_provider_request", { payload: before }, ctxFor("openai-completions", "sess-abc"));
      assert.equal(result.prompt_cache_key, "sess-abc");
      assert.deepEqual(Object.keys(result).sort(), ["max_tokens", "messages", "model", "prompt_cache_key", "thinking"]);
      assert.equal(before.prompt_cache_key, undefined, "the original payload must not be mutated");
      assert.deepEqual({ ...result, prompt_cache_key: undefined }, { ...before, prompt_cache_key: undefined }, "every other byte is unchanged");
    } finally { loaded.restore(); }
  });

  test("clamps a long session id to 64 characters", async () => {
    loaded = await load();
    try {
      const long = "s".repeat(200);
      const result = loaded.pi.emit("before_provider_request", { payload: chatPayload() }, ctxFor("openai-completions", long));
      assert.equal(result.prompt_cache_key.length, 64);
    } finally { loaded.restore(); }
  });

  test("leaves a Responses payload alone — pi already sends the key there", async () => {
    loaded = await load({ LONGCAT_SURFACE: "responses" });
    try {
      const payload = { model: "LongCat-2.0", input: [{ role: "user", content: "hi" }], store: false, prompt_cache_key: "pi-set-this" };
      assert.equal(loaded.pi.emit("before_provider_request", { payload }, ctxFor("openai-responses", "sess-abc")), undefined);
    } finally { loaded.restore(); }
  });

  test("never overwrites a key pi already sent (idempotent under a pi upgrade)", async () => {
    loaded = await load();
    try {
      const payload = { ...chatPayload(), prompt_cache_key: "already-there" };
      assert.equal(loaded.pi.emit("before_provider_request", { payload }, ctxFor("openai-completions", "sess-abc")), undefined);
    } finally { loaded.restore(); }
  });

  test("does nothing without a session id, for another provider, or for a non-object payload", async () => {
    loaded = await load();
    try {
      assert.equal(loaded.pi.emit("before_provider_request", { payload: chatPayload() }, ctxFor("openai-completions", undefined)), undefined);
      assert.equal(loaded.pi.emit("before_provider_request", { payload: chatPayload() }, ctxFor("openai-completions", "sess-abc", "somebody-else")), undefined);
      assert.equal(loaded.pi.emit("before_provider_request", { payload: undefined }, ctxFor("openai-completions", "sess-abc")), undefined);
      assert.equal(loaded.pi.emit("before_provider_request", { payload: "nope" }, ctxFor("openai-completions", "sess-abc")), undefined);
    } finally { loaded.restore(); }
  });

  test("ignores a body that is not a chat request even on the chat surface", async () => {
    loaded = await load();
    try {
      assert.equal(loaded.pi.emit("before_provider_request", { payload: { model: "LongCat-2.0", input: "hi" } }, ctxFor("openai-completions", "sess-abc")), undefined);
    } finally { loaded.restore(); }
  });
});

describe("message_end rewrites", () => {
  let loaded: Awaited<ReturnType<typeof load>>;
  beforeEach(() => { loaded?.restore(); });

  test("a 401 becomes an actionable sentence that keeps the original", async () => {
    loaded = await load();
    try {
      const raw = '401: {"error":{"code":"invalid_api_key","message":"incorrect api key","type":"authentication_error"}}';
      const { message } = runTurn(loaded.pi, raw, { hasUI: false });
      assert.match(String(message.errorMessage), /^LongCat: the API key was rejected/);
      assert.match(String(message.errorMessage), /\[longcat-auth]$/, "the tag rides at the end so the first line stays readable");
      assert.ok(String(message.errorMessage).includes(raw), "the original must survive (S33)");
    } finally { loaded.restore(); }
  });

  test("a balance failure is not relabelled as a credential failure", async () => {
    loaded = await load();
    try {
      const raw = '402: {"error":{"code":"insufficient_quota","message":"Insufficient token quota"}}';
      const { message } = runTurn(loaded.pi, raw, { hasUI: false });
      assert.match(String(message.errorMessage), /^LongCat: this account has no usable balance/);
      assert.match(String(message.errorMessage), /\[longcat-balance]$/);
      assert.doesNotMatch(String(message.errorMessage), /the API key was rejected/);
    } finally { loaded.restore(); }
  });

  test("an overflow gets pi's compaction marker", async () => {
    loaded = await load();
    try {
      const { message } = runTurn(loaded.pi, "400: 输入长度超出上下文限制", { hasUI: false });
      assert.match(String(message.errorMessage), /^context_length_exceeded: /);
    } finally { loaded.restore(); }
  });

  test("the measured cap rejection is left completely alone", async () => {
    loaded = await load();
    try {
      const raw = '400: {"error":{"message":"参数校验失败: \n/max_tokens: 131073 is not less or equal to 131072\n","type":"invalid_request_error","code":"invalid_parameter"}}';
      const { message } = runTurn(loaded.pi, raw, { hasUI: false });
      assert.equal(message.errorMessage, raw, "a bad request must not be rewritten into anything");
    } finally { loaded.restore(); }
  });

  test("another provider's error is never touched", async () => {
    loaded = await load();
    try {
      const raw = "401: invalid api key";
      const { message } = runTurn(loaded.pi, raw, { provider: "somebody-else" });
      assert.equal(message.errorMessage, raw);
    } finally { loaded.restore(); }
  });

  test("a successful assistant message and a non-error stop are ignored", async () => {
    loaded = await load();
    try {
      const ok = { role: "assistant", stopReason: "stop", provider: "longcat", errorMessage: undefined };
      assert.equal(loaded.pi.emit("message_end", { message: ok }), undefined);
      const toolUse = { role: "assistant", stopReason: "toolUse", provider: "longcat", errorMessage: "401 invalid_api_key" };
      assert.equal(loaded.pi.emit("message_end", { message: toolUse }), undefined);
      const user = { role: "user", provider: "longcat", errorMessage: "401 invalid_api_key" };
      assert.equal(loaded.pi.emit("message_end", { message: user }), undefined);
    } finally { loaded.restore(); }
  });
});

describe("turn_end persistent help", () => {
  let loaded: Awaited<ReturnType<typeof load>>;
  beforeEach(() => { loaded?.restore(); });

  test("adds one entry for the auth case and one for the balance case", async () => {
    loaded = await load();
    try {
      const auth = runTurn(loaded.pi, '401: {"error":{"code":"invalid_api_key","message":"incorrect api key"}}');
      const authEntries = (auth.turnResult?.entries ?? []) as any[];
      assert.equal(authEntries.length, 1);
      assert.equal(authEntries[0].customType, "longcat-auth-help");
      assert.equal(authEntries[0].type, "custom_message");
      assert.equal(authEntries[0].display, true);
      assert.match(authEntries[0].content, /longcat\.chat\/platform\/api_keys/);

      const quota = runTurn(loaded.pi, '402: {"error":{"code":"insufficient_quota","message":"Insufficient token quota"}}');
      const quotaEntries = (quota.turnResult?.entries ?? []) as any[];
      assert.equal(quotaEntries.length, 1);
      assert.equal(quotaEntries[0].customType, "longcat-balance-help");
      assert.match(quotaEntries[0].content, /rotating it will not help/);
    } finally { loaded.restore(); }
  });

  test("the entry is reachable AFTER the in-place rewrite (P51) — the auth case is the control", async () => {
    loaded = await load();
    try {
      // runTurn already applies message_end and replaces the stored object in
      // place, so what turn_end sees is our own rewritten text, not the gateway's.
      const auth = runTurn(loaded.pi, '401: {"error":{"code":"invalid_api_key","message":"incorrect api key"}}');
      assert.match(String(auth.message.errorMessage), /^LongCat: /, "precondition: the rewrite happened first");
      assert.equal((auth.turnResult?.entries ?? []).length, 1, "the rewritten message must still classify");
      const quota = runTurn(loaded.pi, "402 insufficient_quota");
      assert.equal((quota.turnResult?.entries ?? []).length, 1);
    } finally { loaded.restore(); }
  });

  test("hasUI false suppresses the entry, so print mode still shows the error", async () => {
    loaded = await load();
    try {
      const { turnResult } = runTurn(loaded.pi, '401: {"error":{"code":"invalid_api_key","message":"x"}}', { hasUI: false });
      assert.equal(turnResult, undefined);
    } finally { loaded.restore(); }
  });

  test("a re-emitted turn does not stack a second entry", async () => {
    loaded = await load();
    try {
      const first = runTurn(loaded.pi, '401: {"error":{"code":"invalid_api_key","message":"x"}}');
      const entries = first.turnResult.entries as any[];
      const second = runTurn(loaded.pi, '401: {"error":{"code":"invalid_api_key","message":"x"}}', { entries });
      assert.equal(second.turnResult, undefined, "deduped on customType");
    } finally { loaded.restore(); }
  });

  test("a non-error outcome, a rate limit and an overflow add nothing", async () => {
    loaded = await load();
    try {
      assert.equal(loaded.pi.emit("turn_end", { outcome: "success", message: errorStop("401 invalid_api_key"), entries: [] }, { hasUI: true }), undefined);
      assert.equal(runTurn(loaded.pi, "429 rate_limit_exceeded: incorrect api key wording").turnResult, undefined);
      assert.equal(runTurn(loaded.pi, "400: 输入长度超出上下文限制").turnResult, undefined, "an overflow compacts; it does not need a key page");
    } finally { loaded.restore(); }
  });

  test("a different message object carrying the rewritten text still classifies", async () => {
    loaded = await load();
    try {
      // pi can hand turn_end a re-hydrated copy (persisted session), so the
      // identity of the object is not something to rely on — only its text.
      const rewritten = "LongCat: the API key was rejected (invalid, revoked…) Original error: 401: invalid_api_key [longcat-auth]";
      const result = loaded.pi.emit(
        "turn_end",
        { outcome: "error", message: { role: "assistant", stopReason: "error", provider: "longcat", errorMessage: rewritten }, entries: [] },
        { hasUI: true },
      );
      assert.equal((result?.entries ?? []).length, 1);
    } finally { loaded.restore(); }
  });
});
