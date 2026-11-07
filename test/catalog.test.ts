/**
 * Catalog data invariants.
 *
 * Tests the DATA, not only the functions that read it: a hand-edited row that
 * silently breaks a rule (an output cap above the window, a cache rate above the
 * input rate, a re-added retired id) has to fail here rather than in front of a
 * user on a paid gateway.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG,
  CATALOG_BY_ID,
  EXCLUDED_MODEL_IDS,
  LONGCAT_THINKING,
  LONGCAT_THINKING_RESPONSES_25,
  MIN_IMAGE_AREA_PX,
  isKnownId,
  normalizeId,
  thinkingLevelsFor,
} from "../catalog.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * The listing body recorded live on 2026-11-07 with KEY1 — the post-GA body, three
 * ids (research/probes/key1-models-2026-11-07.json; all nine keys agreed that day).
 * The 2026-10-10 two-id body is kept as `key1-models.json` for the provenance of
 * the older rows and is deliberately NOT the shape the catalog is checked against.
 */
function recordedListing(): any {
  return JSON.parse(readFileSync(join(FIXTURES, "key1-models-2026-11-07.json"), "utf8"));
}

describe("catalog shape", () => {
  test("ids are unique, exact-cased and LongCat-prefixed", () => {
    const ids = CATALOG.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate ids in CATALOG");
    for (const id of ids) {
      assert.match(id, /^LongCat-/, `${id}: platform ids are case-sensitive and LongCat-prefixed`);
      assert.equal(id, id.trim());
    }
  });

  test("the catalog is exactly the three ids the live listing serves", () => {
    // Recorded GET /openai/v1/models, 2026-11-07 (three ids since the 2026-11-02
    // change log) — a curated catalog that drifts from the gateway should fail
    // here with no key and no network.
    const listed = recordedListing().data.map((m: any) => m.id).sort();
    const curated = CATALOG.map((entry) => entry.id).sort();
    assert.deepEqual(curated, listed);
  });

  test("retired Flash ids are excluded and absent from the catalog", () => {
    const listed = new Set(recordedListing().data.map((m: any) => m.id));
    assert.equal(EXCLUDED_MODEL_IDS.length, 6, "change log 2026-05-29 retired six ids");
    for (const id of EXCLUDED_MODEL_IDS) {
      assert.equal(CATALOG_BY_ID.has(id), false, `${id} must not be registered`);
      assert.equal(listed.has(id), false, `${id} reappeared in the recorded listing — re-check the sunset`);
      assert.match(id, /^LongCat-Flash/, "the exclusion list is the retired Flash family");
    }
  });

  test("known = registered ∪ excluded, alias-normalised", () => {
    for (const entry of CATALOG) {
      assert.equal(isKnownId(entry.id), true);
      assert.equal(isKnownId(entry.id.toUpperCase()), true, "the predicate must be case-insensitive");
      assert.equal(isKnownId(`  ${entry.id}  `), true, "and trim");
    }
    for (const id of EXCLUDED_MODEL_IDS) {
      assert.equal(isKnownId(id), true, "an excluded id must stay known so a refresh cannot re-add it");
      assert.equal(isKnownId(id.toLowerCase()), true);
    }
    assert.equal(isKnownId("LongCat-3.0"), false, "an unseen id is unknown, so the overlay may add it");
    assert.equal(normalizeId(" LongCat-2.0 "), "longcat-2.0");
  });
});

describe("catalog numbers", () => {
  test("contextWindow >= maxTokens for every entry", () => {
    for (const entry of CATALOG) {
      assert.ok(
        entry.contextWindow >= entry.maxTokens,
        `${entry.id}: window ${entry.contextWindow} < output cap ${entry.maxTokens}`,
      );
    }
  });

  test("output caps match the cap-oracle rejections recorded live", () => {
    // Free by construction: the numbers come from a 400 that named the ceiling
    // (research/probes/CAP1-*.json, CAP3-*.json 2026-10-10; CAP7 2026-11-07).
    const cap1 = JSON.parse(readFileSync(join(FIXTURES, "CAP1-chat-2.0-131073.json"), "utf8"));
    const cap3 = JSON.parse(readFileSync(join(FIXTURES, "CAP3-chat-2.5-262145.json"), "utf8"));
    assert.match(cap1.error.message, /not less or equal to 131072/, "the 2026-10-10 oracle row, kept as provenance");
    assert.match(cap3.error.message, /not less or equal to 262144/);
    assert.equal(CATALOG_BY_ID.get("LongCat-2.5")?.maxTokens, 262_144);
    assert.equal(CATALOG_BY_ID.get("LongCat-2.5-Preview")?.maxTokens, 262_144);
  });

  test("LongCat-2.0's ceiling is CONTRADICTORY, and the catalog keeps the published clamp", () => {
    // 2026-11-07: max_tokens 131073 was ACCEPTED (HTTP 200 — CAP8 fixture) and only
    // 262145 was rejected, naming 262144 (CAP7). So the validator's ceiling moved
    // to 262144 while the listing still advertises 131072. An accepted request
    // proves the validator gave way, not that 2.0 emits 131073 tokens, so the
    // catalog keeps the conservative published number — and this test pins BOTH
    // facts so a future sweep cannot silently "fix" one half.
    const accepted = JSON.parse(readFileSync(join(FIXTURES, "CAP8-chat-2.0-131073-accepted.json"), "utf8"));
    const rejected = JSON.parse(readFileSync(join(FIXTURES, "CAP7-chat-2.0-262145.json"), "utf8"));
    assert.equal(accepted.model, "LongCat-2.0");
    assert.ok(accepted.usage?.total_tokens > 0, "an accepted cap probe is billed — that is why it lives in a fixture");
    assert.match(rejected.error.message, /not less or equal to 262144/);
    assert.equal(CATALOG_BY_ID.get("LongCat-2.0")?.maxTokens, 131_072, "the published clamp, not the validator's 262144");
    const listed = recordedListing().data.find((m: any) => m.id === "LongCat-2.0");
    assert.equal(listed.max_output_tokens, 131_072, "and the listing still agrees with the clamp, not with the validator");
  });

  test("windows match both machine-readable sources", () => {
    const listing = recordedListing();
    for (const entry of CATALOG) {
      const listed = listing.data.find((m: any) => m.id === entry.id);
      assert.equal(entry.contextWindow, listed.context_window, `${entry.id}: window != listing`);
    }
  });

  test("prices are non-zero, and a cache hit never costs more than a miss", () => {
    for (const entry of CATALOG) {
      assert.ok(entry.cny.input > 0, `${entry.id}: input price must not be zero (it is not free)`);
      assert.ok(entry.cny.output > 0, `${entry.id}: output price must not be zero`);
      assert.ok(entry.cny.cacheRead > 0, `${entry.id}: the platform publishes a cache-hit rate`);
      assert.ok(entry.cny.cacheRead < entry.cny.input, `${entry.id}: cacheRead >= input`);
    }
  });

  test("prices match the machine-readable pricing object, which is CNY", () => {
    // GET /openai/v1/models/{id}, 2026-10-10: {"prompt":"2","completion":"8",
    // "cached_tokens":"0.04"} — the CNY column of the pricing page, not the USD
    // column ($0.30/$1.20/$0.006). This is the evidence that these keys bill CNY.
    for (const file of ["retrieve-2.0.json", "retrieve-2.5-preview.json", "retrieve-2.5-ga.json"]) {
      const detail = JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));
      const entry = CATALOG_BY_ID.get(detail.id);
      assert.ok(entry, `${detail.id} missing from the catalog`);
      assert.equal(entry.cny.input, Number(detail.pricing.prompt));
      assert.equal(entry.cny.output, Number(detail.pricing.completion));
      assert.equal(entry.cny.cacheRead, Number(detail.pricing.cached_tokens));
    }
  });

  test("modalities match the listing and the measured behaviour", () => {
    const ga = CATALOG_BY_ID.get("LongCat-2.5");
    const preview = CATALOG_BY_ID.get("LongCat-2.5-Preview");
    const two = CATALOG_BY_ID.get("LongCat-2.0");
    assert.deepEqual(ga?.input, ["text", "image"]);
    assert.deepEqual(preview?.input, ["text", "image"]);
    // 2.0 is text-only by listing AND by measurement: an image part was accepted
    // with input_tokens unchanged (19 with and without the png, 2026-10-11).
    assert.deepEqual(two?.input, ["text"]);
    // The GA listing also advertises "video". pi has no modality for it, so the
    // catalog claims image only — this asserts the disagreement is real and that
    // it is deliberate, not that video disappeared from the platform.
    const gaDetail = JSON.parse(readFileSync(join(FIXTURES, "retrieve-2.5-ga.json"), "utf8"));
    assert.deepEqual(gaDetail.architecture.input_modalities, ["text", "image", "video"]);
    assert.equal(MIN_IMAGE_AREA_PX, 200, "the floor measured 2026-11-07 (relaxed from 256)");
    const detail = JSON.parse(readFileSync(join(FIXTURES, "retrieve-2.0.json"), "utf8"));
    assert.deepEqual(detail.architecture.input_modalities, ["text"]);
  });
});

describe("thinking control", () => {
  test("every curated entry has a toggle, and the off switch is reachable on the map it carries", () => {
    for (const entry of CATALOG) {
      assert.equal(entry.thinking.kind, "toggle", `${entry.id}: LongCat's switch is a binary toggle`);
      if (entry.thinking.kind !== "toggle") continue;
      // The entry-level map is the CHAT map, where `off: null` would HIDE the
      // level and clamp requests UP to `low`, billing thinking the user turned
      // off — chat's disabled token is measured working on both models, so off
      // must stay a string here. The one measured exception (2.5 family on the
      // Responses surface, where NO off token works) is applied per surface by
      // thinkingLevelsFor, tested below.
      assert.notEqual(entry.thinking.levels.off, null, `${entry.id}: off must not be null`);
      assert.equal(typeof entry.thinking.levels.off, "string");
    }
  });

  test("the level map offers exactly one positive level (the vendor has no effort scale)", () => {
    const positive = Object.entries(LONGCAT_THINKING).filter(([level, value]) => level !== "off" && value !== null);
    assert.deepEqual(positive, [["low", "low"]]);
    assert.equal(LONGCAT_THINKING.off, "none", `"none" is the effort token measured to zero reasoning on Responses/2.0`);
  });

  test("thinkingLevelsFor hides off only for the 2.5 family on Responses", () => {
    // The 2026-10-24 measurements behind each branch: DD-B6 (2.0 effort:none →
    // reasoning_tokens 0) vs DD-B5/B7/B8 (2.5-Preview: effort:none → 161,
    // thinking:disabled → 299, both → 125 — nothing zeroes it).
    assert.equal(thinkingLevelsFor("LongCat-2.5-Preview", "openai-responses", LONGCAT_THINKING), LONGCAT_THINKING_RESPONSES_25);
    assert.equal(LONGCAT_THINKING_RESPONSES_25.off, null, "off is hidden, not sold as a dead switch");
    assert.equal(LONGCAT_THINKING_RESPONSES_25.low, "low", "the one positive level survives");
    assert.equal(thinkingLevelsFor("LongCat-2.0", "openai-responses", LONGCAT_THINKING), LONGCAT_THINKING);
    assert.equal(thinkingLevelsFor("LongCat-2.5-Preview", "openai-completions", LONGCAT_THINKING), LONGCAT_THINKING, "chat's disabled token works on both models");
    // Family inheritance for an unmeasured future 2.5-x id: no off offered on
    // Responses rather than an unverified token (same convention as guessContext).
    assert.equal(thinkingLevelsFor("LongCat-2.5-Turbo", "openai-responses", LONGCAT_THINKING), LONGCAT_THINKING_RESPONSES_25);
  });
});
