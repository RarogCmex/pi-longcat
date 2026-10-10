/**
 * Live-overlay tests: parsing, the unknowns-only rule, key resolution, and the
 * "never throw, never stall" contract pi depends on. The listing fixture is the
 * body recorded from GET /openai/v1/models with KEY1 on 2026-10-10.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import { EXCLUDED_MODEL_IDS } from "../catalog.ts";
import { buildOverlay, fetchLongCatModels, parseListing, resolveKey } from "../discovery.ts";
import { API_KEY_ENV_VAR, BASE_URL } from "../models.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const LISTING = readFileSync(join(FIXTURES, "key1-models.json"), "utf8");

function context(overrides: Partial<RefreshModelsContext> = {}): RefreshModelsContext {
  return {
    allowNetwork: true,
    signal: new AbortController().signal,
    credential: { type: "api_key", key: "ak_test" },
    ...overrides,
  } as unknown as RefreshModelsContext;
}

describe("parseListing", () => {
  test("reads the recorded listing, ids and published limits", () => {
    const parsed = parseListing(JSON.parse(LISTING));
    assert.deepEqual(
      parsed.map((m) => m.id),
      ["LongCat-2.5-Preview", "LongCat-2.0"],
    );
    assert.deepEqual(parsed[0], { id: "LongCat-2.5-Preview", contextWindow: 1_048_576, maxTokens: 262_144 });
    assert.deepEqual(parsed[1], { id: "LongCat-2.0", contextWindow: 1_048_576, maxTokens: 131_072 });
  });

  test("accepts the raw body text too, and tolerates garbage", () => {
    assert.equal(parseListing(LISTING).length, 2);
    assert.deepEqual(parseListing("not json"), []);
    assert.deepEqual(parseListing(null), []);
    assert.deepEqual(parseListing({}), []);
    assert.deepEqual(parseListing({ data: "nope" }), []);
    assert.deepEqual(parseListing({ data: [{ id: 42 }, { id: "  " }, null, { id: "ok" }] }).map((m) => m.id), ["ok"]);
  });

  test("an in-band 200 error body yields no models, not a broken catalog", () => {
    const inBand = readFileSync(join(FIXTURES, "retrieve-bogus-inband-200.json"), "utf8");
    assert.deepEqual(parseListing(inBand), []);
    assert.deepEqual(parseListing(JSON.parse(inBand)), []);
  });

  test("dedupes and drops non-chat modalities if the platform ever lists them", () => {
    const payload = {
      data: [
        { id: "LongCat-2.0" },
        { id: "LongCat-2.0" },
        { id: "longcat-embed-v1" },
        { id: "longcat-tts" },
        { id: "longcat-rerank" },
        { id: "LongCat-3.0" },
      ],
    };
    assert.deepEqual(parseListing(payload).map((m) => m.id), ["LongCat-2.0", "LongCat-3.0"]);
  });

  test("ignores a non-positive or non-numeric limit rather than publishing it", () => {
    const parsed = parseListing({ data: [{ id: "x", context_window: 0, max_output_tokens: -5 }] });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.id, "x");
    assert.equal(parsed[0]!.contextWindow, undefined, "a zero window must not be published");
    assert.equal(parsed[0]!.maxTokens, undefined, "a negative cap must not be published");
  });
});

describe("buildOverlay", () => {
  test("is unknowns-only: curated ids keep their measured caps and prices", () => {
    const overlay = buildOverlay(parseListing(JSON.parse(LISTING)), "openai-completions", BASE_URL);
    assert.deepEqual(overlay, [], "both listed ids are curated, so the overlay adds nothing");
  });

  test("never re-adds a deliberately excluded id, in any casing", () => {
    for (const id of EXCLUDED_MODEL_IDS) {
      for (const variant of [id, id.toLowerCase(), ` ${id} `]) {
        const overlay = buildOverlay([{ id: variant }], "openai-completions", BASE_URL);
        assert.deepEqual(overlay, [], `${variant} is retired and must not come back`);
      }
    }
  });

  test("registers an unknown id with the listing's own numbers, on the active surface", () => {
    const overlay = buildOverlay([{ id: "LongCat-3.0", contextWindow: 262_144, maxTokens: 65_536 }], "openai-responses", BASE_URL);
    assert.equal(overlay.length, 1);
    assert.equal(overlay[0]!.id, "LongCat-3.0");
    assert.equal(overlay[0]!.api, "openai-responses", "the overlay must be stamped with the registered surface");
    assert.equal(overlay[0]!.contextWindow, 262_144);
    assert.deepEqual(overlay[0]!.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, "an unknown id is never priced");
  });
});

describe("resolveKey", () => {
  test("prefers the stored credential and trims it", () => {
    assert.equal(resolveKey({ credential: { type: "api_key", key: "  ak_stored  " } } as any, () => undefined), "ak_stored");
  });

  test("falls back to the env var for env-only setups", () => {
    assert.equal(resolveKey({ credential: undefined } as any, (n) => (n === API_KEY_ENV_VAR ? " ak_env " : undefined)), "ak_env");
  });

  test("returns undefined when there is nothing, so discovery degrades instead of guessing", () => {
    assert.equal(resolveKey({ credential: undefined } as any, () => undefined), undefined);
    assert.equal(resolveKey({ credential: { type: "oauth", token: "x" } } as any, () => undefined), undefined);
    assert.equal(resolveKey({ credential: { type: "api_key", key: "   " } } as any, () => undefined), undefined);
  });
});

describe("fetchLongCatModels never throws and never stalls", () => {
  const targets = { listingBaseUrl: BASE_URL, baseUrl: BASE_URL, api: "openai-completions" as const };
  const stub = (impl: typeof fetch) => impl;

  test("no key ⇒ no request, empty overlay", async () => {
    let called = 0;
    const original = globalThis.fetch;
    globalThis.fetch = stub((async () => {
      called++;
      throw new Error("must not be called");
    }) as unknown as typeof fetch);
    try {
      const out = await fetchLongCatModels(targets, context({ credential: undefined }) as any, 100);
      assert.deepEqual(out, []);
      assert.equal(called, 0);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("network disabled or aborted ⇒ empty overlay", async () => {
    const out = await fetchLongCatModels(targets, context({ allowNetwork: false }) as any, 100);
    assert.deepEqual(out, []);
    const controller = new AbortController();
    controller.abort();
    assert.deepEqual(await fetchLongCatModels(targets, context({ signal: controller.signal }) as any, 100), []);
  });

  test("a listing with a new id produces exactly one overlay model", async () => {
    const original = globalThis.fetch;
    let url = "";
    let authHeader = "";
    globalThis.fetch = stub((async (input: any, init: any) => {
      url = String(input);
      authHeader = init?.headers?.Authorization ?? "";
      return new Response(JSON.stringify({ data: [{ id: "LongCat-2.0", context_window: 1 }, { id: "LongCat-3.0", context_window: 262_144 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch);
    try {
      const out = await fetchLongCatModels(targets, context(), 500);
      assert.equal(url, `${BASE_URL}/models`);
      assert.equal(authHeader, "Bearer ak_test", "the listing needs the key (401 without one, measured)");
      assert.equal(out.length, 1);
      assert.equal(out[0]!.id, "LongCat-3.0");
      assert.equal(out[0]!.contextWindow, 262_144, "the gateway's own number beats the family guess");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("401, 500, an in-band 200 error and a thrown fetch all degrade to the baseline", async () => {
    const original = globalThis.fetch;
    const cases: (typeof fetch)[] = [
      (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch,
      (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
      (async () => new Response(readFileSync(join(FIXTURES, "retrieve-bogus-inband-200.json"), "utf8"), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch,
      (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    ];
    try {
      for (const impl of cases) {
        globalThis.fetch = impl;
        assert.deepEqual(await fetchLongCatModels(targets, context(), 500), []);
      }
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a hung gateway is cut off by our own timeout, and the abort listener is removed", async () => {
    const original = globalThis.fetch;
    const signal = new AbortController().signal;
    let listeners = 0;
    const counted = {
      addEventListener: (type: string, fn: any, opts: any) => {
        if (type === "abort") listeners++;
        return signal.addEventListener(type, fn, opts);
      },
      removeEventListener: (type: string, fn: any) => {
        if (type === "abort") listeners--;
        return signal.removeEventListener(type, fn);
      },
      aborted: false,
    } as unknown as AbortSignal;
    // Behaves like the real thing: an aborted signal rejects the request rather
    // than resolving late (which is what makes the timeout observable).
    globalThis.fetch = stub((async (_input: any, init: any) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response("{}", { status: 200 })), 5_000);
        init.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          },
          { once: true },
        );
      });
    }) as unknown as typeof fetch);
    try {
      const started = Date.now();
      const out = await fetchLongCatModels(targets, context({ signal: counted }) as any, 60);
      assert.deepEqual(out, []);
      assert.ok(Date.now() - started < 1_000, "our own timeout must cut a hung listing off");
      assert.equal(listeners, 0, "the listener must be removed, or a later abort can never settle");
    } finally {
      globalThis.fetch = original;
    }
  });
});
