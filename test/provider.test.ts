/**
 * Provider assembly: the registered surface, the in-band remediation wrapper,
 * and the `/login` flow including its zero-inference key check.
 *
 * `createProvider` returns an opaque object — `api` and `fetchModels` are
 * captured in a closure and are not readable off the result — so the assertions
 * go through `getModels()` / `stream()`, which is what pi itself uses.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { normalizeContext } from "@earendil-works/pi-ai";
import {
  API_KEY_AUTH_NAME,
  API_KEY_ENV_VAR,
  buildLongCatProvider,
  keyLooksValid,
  longcatApiKeyAuth,
  withGatewayErrorRemediation,
  withToolArgumentRepair,
} from "../provider.ts";
import { BASE_URL, PROVIDER_ID } from "../models.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8").trim();

const transcript = normalizeContext({
  systemPrompt: "You are pi.",
  messages: [{ role: "user", content: "Say hi.", timestamp: Date.now() }],
});

/** A ProviderStreams whose every call is recorded, so the wrapper is observable. */
function recordingStreams(response?: Response) {
  const calls: { kind: string; hadFetch: boolean }[] = [];
  const inner = {
    stream: (_m: any, _c: any, options: any) => {
      calls.push({ kind: "stream", hadFetch: typeof options?.fetch === "function" });
      return (async function* () {
        if (options?.fetch) {
          const res = await options.fetch("https://api.longcat.chat/openai/v1/chat/completions", {});
          yield { type: "start", message: { status: res.status, body: await res.clone().text() } };
        }
        yield { type: "done" };
      })() as any;
    },
    streamSimple: (_m: any, _c: any, options: any) => {
      calls.push({ kind: "streamSimple", hadFetch: typeof options?.fetch === "function" });
      return (async function* () {
        yield { type: "done" };
      })() as any;
    },
    fetchDeferred: async () => undefined,
    cancelDeferred: async () => undefined,
  };
  return { inner: inner as any, calls, response };
}

describe("buildLongCatProvider", () => {
  test("registers the longcat id with the catalog on the chosen surface", () => {
    const provider = buildLongCatProvider("openai-completions", openAICompletionsApi(), () => undefined, BASE_URL);
    assert.equal(provider.id, PROVIDER_ID);
    assert.equal(provider.name, "LongCat (Meituan)");
    assert.equal(provider.baseUrl, BASE_URL);
    const models = provider.getModels();
    assert.deepEqual(models.map((m) => m.id), ["LongCat-2.5-Preview", "LongCat-2.0"]);
    for (const model of models) {
      assert.equal(model.api, "openai-completions");
      assert.equal(model.provider, PROVIDER_ID);
      assert.equal(model.baseUrl, BASE_URL);
    }
  });

  test("the Responses registration stamps the other api and its own compat", () => {
    const provider = buildLongCatProvider("openai-responses", openAICompletionsApi(), () => undefined, BASE_URL);
    for (const model of provider.getModels()) assert.equal(model.api, "openai-responses");
  });

  test("LONGCAT_BASE_URL and LONGCAT_CNY_PER_USD reach the models", () => {
    const env = (name: string) => ({ LONGCAT_BASE_URL: "https://proxy.example/lg", LONGCAT_CNY_PER_USD: "7.5" })[name];
    const provider = buildLongCatProvider("openai-completions", openAICompletionsApi(), env);
    assert.equal(provider.baseUrl, "https://proxy.example/lg");
    const model = provider.getModels()[0]!;
    assert.equal(model.baseUrl, "https://proxy.example/lg");
    assert.equal(model.cost.input, Math.round((2 / 7.5) * 1e6) / 1e6);
  });

  test("exposes an apiKey auth (so /login offers the provider) and no oauth", () => {
    const provider = buildLongCatProvider("openai-completions", openAICompletionsApi(), () => undefined, BASE_URL) as any;
    assert.ok(provider.auth?.apiKey, "without auth pi hides the provider from /login and the picker");
    assert.equal(provider.auth.oauth, undefined);
  });
});

describe("withGatewayErrorRemediation", () => {
  test("injects a fetch that re-statuses an in-band 200 error", async () => {
    const { inner, calls } = recordingStreams();
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(fixture("responses-inband-200.json"), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      const wrapped = withGatewayErrorRemediation(inner);
      const events: any[] = [];
      for await (const event of wrapped.stream({} as any, transcript, {} as any)) events.push(event);
      assert.deepEqual(calls, [{ kind: "stream", hadFetch: true }]);
      assert.equal(events[0].message.status, 400, "the in-band body must come back as a real 400");
      assert.match(events[0].message.body, /invalid_prompt/);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("chains onto a caller-supplied fetch instead of replacing it", async () => {
    const { inner } = recordingStreams();
    let innerCalled = 0;
    const callerFetch = (async () => {
      innerCalled++;
      return new Response(fixture("T2-thinking-disabled.json"), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const wrapped = withGatewayErrorRemediation(inner);
    for await (const _ of wrapped.stream({} as any, transcript, { fetch: callerFetch } as any)) {
      /* drain */
    }
    assert.equal(innerCalled, 1, "pi may pass its own proxying fetch; we must not drop it");
  });

  test("does not double-wrap (idempotent under a second registration)", async () => {
    const { inner } = recordingStreams();
    const once = withGatewayErrorRemediation(inner);
    const twice = withGatewayErrorRemediation(once);
    let depth = 0;
    const counting = (async () => {
      depth++;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    for await (const _ of twice.stream({} as any, transcript, { fetch: counting } as any)) {
      /* drain */
    }
    assert.equal(depth, 1, "one wrap, not two");
  });

  test("keeps the optional deferred members", () => {
    const { inner } = recordingStreams();
    const wrapped = withGatewayErrorRemediation(inner) as any;
    assert.equal(typeof wrapped.fetchDeferred, "function");
    assert.equal(typeof wrapped.cancelDeferred, "function");
    assert.equal(typeof wrapped.streamSimple, "function");
  });
});

describe("withToolArgumentRepair", () => {
  /**
   * An adapter stream with the two members pi actually uses — `for await` and
   * `result()`. A real AssistantMessageEventStream is not needed to prove the
   * wrapper, and constructing one would drag the queue implementation into the
   * assertion instead of the behaviour under test.
   */
  const source = (events: any[]) => {
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (const event of events) yield event;
      },
      result: async () => {
        const done = events.find((event) => event.type === "done");
        const error = events.find((event) => event.type === "error");
        return done?.message ?? error?.error;
      },
    };
    return stream as any;
  };

  const brokenText =
    '{"action": "route", "query": pentest: check leaked casino credentials against live site, ' +
    'dump peers/requisites via API, "role": sadnes, "load": primary, "name": "", "period": 0}';
  const argumentsError = `Unexpected token 'p', ..." "query": pentest: c"... is not valid JSON\n\nReceived arguments:\n${brokenText}`;

  /** One turn as the Responses adapter emits it: start → toolcall_* → done. */
  const turn = (argumentsError?: string) => {
    const block: any = { type: "toolCall", id: "call_1", name: "debi_skill", arguments: {} };
    if (argumentsError) block.argumentsError = argumentsError;
    const message: any = { role: "assistant", content: [block], stopReason: "toolUse" };
    const events = [
      { type: "start", partial: message },
      { type: "toolcall_start", contentIndex: 0, partial: message },
      { type: "toolcall_end", contentIndex: 0, toolCall: block, partial: message },
      { type: "done", reason: "toolUse", message },
    ];
    return { block, message, events };
  };

  const streamsFor = (events: any[]) => {
    const seen: string[] = [];
    const api = {
      stream: (_m: any, _c: any) => {
        seen.push("stream");
        return source(events);
      },
      streamSimple: (_m: any, _c: any) => {
        seen.push("streamSimple");
        return source(events);
      },
      fetchDeferred: (_m: any, _h: any) => {
        seen.push("fetchDeferred");
        return source(events);
      },
      cancelDeferred: async () => {
        seen.push("cancelDeferred");
      },
    } as any;
    return { api, seen };
  };

  test("a broken tool call is repaired on the stream, in place, before pi sees it", async () => {
    const { block, events } = turn(argumentsError);
    const { api } = streamsFor(events);
    const wrapped = withToolArgumentRepair(api, () => undefined);
    const drained: any[] = [];
    for await (const event of wrapped.stream({} as any, transcript, {} as any)) drained.push(event);

    assert.deepEqual(
      drained.map((event) => event.type),
      ["start", "toolcall_start", "toolcall_end", "done"],
      "event order and count must be exactly the adapter's",
    );
    assert.equal(block.argumentsError, undefined, "the refusal must be gone from the block itself");
    assert.equal(block.arguments.role, "sadnes");
    assert.match(block.arguments.query, /^pentest: check leaked casino credentials against live site/);
    assert.equal(block.arguments.period, 0);
    // The done message carries the same block — pi validates THAT one.
    assert.equal(drained[3].message.content[0], block);
  });

  test("result() alone (pi's complete() path) also receives the repaired call", async () => {
    const { block, events } = turn(argumentsError);
    const { api } = streamsFor(events);
    const wrapped = withToolArgumentRepair(api, () => undefined);
    // No iteration at all: a wrapper built on a second stream would deadlock here.
    const message = await wrapped.stream({} as any, transcript, {} as any).result();
    assert.equal(message.content[0], block);
    assert.equal(block.argumentsError, undefined);
    assert.equal(block.arguments.action, "route");
  });

  test("a valid call is passed through untouched", async () => {
    const { block, events } = turn();
    block.arguments = { action: "route", query: "pentest: check" };
    const snapshot = JSON.parse(JSON.stringify(block));
    const { api } = streamsFor(events);
    const wrapped = withToolArgumentRepair(api, () => undefined);
    for await (const _ of wrapped.stream({} as any, transcript, {} as any)) {
      /* drain */
    }
    assert.deepEqual(block, snapshot);
  });

  test("an unrecoverable text keeps its honest refusal", async () => {
    const raw = '{"edits": [{"oldText": "line\\n with \\"quote\\", "newText": "x"}]}';
    const { block, events } = turn(`Expected ',' or '}' after property value\n\nReceived arguments:\n${raw}`);
    const { api } = streamsFor(events);
    const wrapped = withToolArgumentRepair(api, () => undefined);
    for await (const _ of wrapped.stream({} as any, transcript, {} as any)) {
      /* drain */
    }
    assert.match(String(block.argumentsError), /Received arguments:/);
    assert.deepEqual(block.arguments, {});
  });

  test("streamSimple, fetchDeferred and cancelDeferred survive the wrap", async () => {
    const simpleTurn = turn(argumentsError);
    const deferredTurn = turn(argumentsError);
    const seen: string[] = [];
    const api = {
      stream: () => source([]),
      streamSimple: () => {
        seen.push("streamSimple");
        return source(simpleTurn.events);
      },
      fetchDeferred: () => {
        seen.push("fetchDeferred");
        return source(deferredTurn.events);
      },
      cancelDeferred: async () => {
        seen.push("cancelDeferred");
      },
    } as any;
    const wrapped = withToolArgumentRepair(api, () => undefined) as any;
    assert.equal(typeof wrapped.streamSimple, "function");
    assert.equal(typeof wrapped.fetchDeferred, "function");
    assert.equal(typeof wrapped.cancelDeferred, "function");

    for await (const _ of wrapped.streamSimple({} as any, transcript, {} as any)) {
      /* drain */
    }
    assert.equal(simpleTurn.block.argumentsError, undefined, "streamSimple must be repaired too");

    await wrapped.fetchDeferred({} as any, {} as any, {} as any).result();
    assert.equal(deferredTurn.block.argumentsError, undefined, "a deferred result must be repaired too");

    await wrapped.cancelDeferred({} as any, {} as any);
    assert.deepEqual(seen, ["streamSimple", "fetchDeferred", "cancelDeferred"]);
  });

  test("LONGCAT_TOOL_REPAIR=off returns the surface itself, not a wrapper", () => {
    const { api } = streamsFor(turn(argumentsError).events);
    const wrapped = withToolArgumentRepair(api, (name) => (name === "LONGCAT_TOOL_REPAIR" ? "off" : undefined));
    assert.equal(wrapped, api, "the off switch must not leave a pass-through layer behind");
  });
});

describe("keyLooksValid (the zero-inference login oracle)", () => {
  const stub = (status: number, body = "{}") =>
    (async () => new Response(body, { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

  test("200 means valid; 401 and 403 mean invalid", async () => {
    assert.equal(await keyLooksValid("ak_x", BASE_URL, stub(200), 100), true);
    assert.equal(await keyLooksValid("ak_x", BASE_URL, stub(401, fixture("badkey-chat.json")), 100), false);
    assert.equal(await keyLooksValid("ak_x", BASE_URL, stub(403), 100), false);
  });

  test("fails OPEN on anything that is not a credential rejection", async () => {
    // A 5xx or a 429 says nothing about the key; refusing to save a good key
    // because the gateway had a bad minute is the worse failure.
    assert.equal(await keyLooksValid("ak_x", BASE_URL, stub(500), 100), true);
    assert.equal(await keyLooksValid("ak_x", BASE_URL, stub(429), 100), true);
    const throwing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    assert.equal(await keyLooksValid("ak_x", BASE_URL, throwing, 100), true);
  });

  test("sends the key as a Bearer token to the listing, and aborts on a hang", async () => {
    let url = "";
    let auth = "";
    const spy = (async (input: any, init: any) => {
      url = String(input);
      auth = init.headers.Authorization;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    assert.equal(await keyLooksValid("  ak_trimmed  ", BASE_URL, spy, 100), true);
    assert.equal(url, `${BASE_URL}/models`);
    assert.equal(auth, "Bearer   ak_trimmed  ");
    const slow = ((_input: any, init: any) =>
      new Promise((_resolve, reject) => {
        const t = setTimeout(() => reject(new Error("late")), 5_000);
        init.signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true });
      })) as unknown as typeof fetch;
    assert.equal(await keyLooksValid("ak_x", BASE_URL, slow, 50), true, "a timeout must not reject the key");
  });
});

describe("longcatApiKeyAuth", () => {
  function interaction(answers: { prompt?: string; aborts?: boolean }) {
    const notified: any[] = [];
    const prompts: any[] = [];
    return {
      notified,
      prompts,
      api: {
        signal: { throwIfAborted: () => { if (answers.aborts) throw new Error("aborted"); } } as any,
        notify: (event: any) => { notified.push(event); },
        prompt: async (request: any) => {
          prompts.push(request);
          if (answers.prompt === undefined) throw new Error("cancelled");
          return answers.prompt;
        },
      } as any,
    };
  }

  /** pi-ai's resolve contract: `{ctx, credential, signal}`, with env read via ctx.env. */
  const resolveInput = (credential: unknown, env: Record<string, string> = {}) =>
    ({
      ctx: { env: async (name: string) => env[name] },
      credential,
      signal: new AbortController().signal,
    }) as any;

  test("resolves a stored key and trims it", async () => {
    const auth = longcatApiKeyAuth();
    const resolved = await auth.resolve!(resolveInput({ type: "api_key", key: "  ak_stored  " }));
    assert.equal(resolved?.auth.apiKey, "ak_stored", "a trailing newline would 401 like a revoked key");
  });

  test("falls back to the env var, trims it, and reports where it came from", async () => {
    const auth = longcatApiKeyAuth();
    const resolved = await auth.resolve!(resolveInput(undefined, { [API_KEY_ENV_VAR]: " ak_from_env " }));
    assert.equal(resolved?.auth.apiKey, "ak_from_env");
    assert.equal(resolved?.source, API_KEY_ENV_VAR);
    assert.equal(API_KEY_AUTH_NAME, "LongCat API key");
  });

  test("no stored key and no env var resolves to undefined (pi then hides the provider)", async () => {
    const auth = longcatApiKeyAuth();
    assert.equal(await auth.resolve!(resolveInput(undefined)), undefined);
    assert.equal(await auth.resolve!(resolveInput({ type: "api_key", key: "   " })), undefined);
  });

  test("/login shows the key page, asks for a secret, and saves a valid key", async () => {
    const auth = longcatApiKeyAuth((async () => new Response("{}", { status: 200 })) as unknown as typeof fetch, () => BASE_URL);
    const { api, notified, prompts } = interaction({ prompt: "  ak_good  " });
    const result = await auth.login!(api);
    assert.deepEqual(result, { type: "api_key", key: "ak_good" });
    assert.equal(prompts[0].type, "secret");
    assert.equal(prompts[0].placeholder, "ak_...");
    assert.equal(notified[0].type, "info", "there is no 'warning' AuthEvent type");
    assert.match(notified[0].links[0].url, /longcat\.chat\/platform\/api_keys/);
  });

  test("/login refuses a key the gateway rejects, and says why", async () => {
    const auth = longcatApiKeyAuth(
      (async () => new Response(fixture("badkey-chat.json"), { status: 401 })) as unknown as typeof fetch,
      () => BASE_URL,
    );
    const { api } = interaction({ prompt: "ak_wrongtab" });
    await assert.rejects(() => auth.login!(api), /rejected by api\.longcat\.chat/);
  });

  test("/login saves a key when the check cannot reach the gateway", async () => {
    const auth = longcatApiKeyAuth(
      (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch,
      () => BASE_URL,
    );
    const { api } = interaction({ prompt: "ak_offline" });
    assert.deepEqual(await auth.login!(api), { type: "api_key", key: "ak_offline" });
  });

  test("/login warns on an unexpected prefix but does not reject it", async () => {
    const auth = longcatApiKeyAuth((async () => new Response("{}", { status: 200 })) as unknown as typeof fetch, () => BASE_URL);
    const { api, notified } = interaction({ prompt: "sk-something-else" });
    assert.deepEqual(await auth.login!(api), { type: "api_key", key: "sk-something-else" });
    assert.equal(notified.length, 2);
    assert.match(notified[1].message, /does not look like a LongCat key/);
  });

  test("/login refuses an empty key and honours cancellation", async () => {
    const ok = longcatApiKeyAuth((async () => new Response("{}", { status: 200 })) as unknown as typeof fetch, () => BASE_URL);
    await assert.rejects(() => ok.login!(interaction({ prompt: "   " }).api), /No API key entered/);
    const aborted = longcatApiKeyAuth((async () => new Response("{}", { status: 200 })) as unknown as typeof fetch, () => BASE_URL);
    await assert.rejects(() => aborted.login!(interaction({ prompt: "ak_x", aborts: true }).api), /aborted/);
    const cancelled = longcatApiKeyAuth((async () => new Response("{}", { status: 200 })) as unknown as typeof fetch, () => BASE_URL);
    await assert.rejects(() => cancelled.login!(interaction({}).api), /cancelled/);
  });
});
