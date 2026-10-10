/**
 * Secret hygiene.
 *
 * Two real leaks in this repo's history came from a key pasted into a README
 * example and from a historical blob, so the tree is scanned structurally rather
 * than trusted:
 *   - nothing that looks like a full LongCat key (`ak_` + 16 or more key
 *     characters) may appear in any file we ship. Redacted prefixes used in docs
 *     and tests (`ak_2uz…`, `ak_test`, `ak_good`) are short and must stay legal;
 *   - if `secret.env` or the environment carries real keys, no 12-character
 *     window of them may appear anywhere in the tree — the test compares
 *     fingerprints and never prints a key, so a failure cannot leak it either;
 *   - `.gitignore` must cover `secret.env` and `node_modules/` from commit #1.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP_DIRS = new Set([".git", "node_modules"]);
const SKIP_FILES = new Set(["secret.env", "package-lock.json"]);
const TEXT_EXT = /\.(ts|js|mjs|cjs|json|md|py|txt|yml|yaml|env|html)$/i;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (SKIP_DIRS.has(entry)) continue;
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (!SKIP_FILES.has(entry) && TEXT_EXT.test(entry)) yield path;
  }
}

const FILES = [...walk(ROOT)];

/** Full-key shape. Deliberately permissive about the alphabet, strict about length. */
const KEY_SHAPED = /ak_[A-Za-z0-9_-]{16,}/g;

function realKeys(): string[] {
  const keys: string[] = [];
  const envFile = join(ROOT, "secret.env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = /^\s*KEY\d+\s*=\s*(\S+)\s*$/.exec(line);
      if (m && m[1].length >= 12) keys.push(m[1]);
    }
  }
  for (let i = 1; i <= 9; i++) {
    const value = process.env[`KEY${i}`];
    if (value && value.length >= 12) keys.push(value);
  }
  return [...new Set(keys)];
}

describe("secret hygiene", () => {
  test("the tree is actually being scanned", () => {
    // A detector that fails open is worse than none (pitfalls L39): fire it at a
    // positive control first, and assert the scan covers the shipped sources.
    assert.ok(FILES.length > 20, `only ${FILES.length} files scanned — the walk is broken`);
    for (const required of ["index.ts", "provider.ts", "catalog.ts", "models.ts", "errors.ts", "discovery.ts", "README.md"]) {
      if (required === "README.md" && !existsSync(join(ROOT, required))) continue;
      assert.ok(FILES.some((f) => f.endsWith(required)), `${required} was not scanned`);
    }
    // Built at runtime, never written as a literal: a positive control that the
    // scanner itself would flag is a control that breaks the suite.
    const control = ["ak_", "x".repeat(24)].join("");
    assert.match(control, KEY_SHAPED, "the detector must fire on a full-length key");
    assert.equal(KEY_SHAPED.test(["ak_", "short"].join("")), false, "and must ignore a redacted prefix");
    KEY_SHAPED.lastIndex = 0;
  });

  test("no full-length key shape appears in any shipped file", () => {
    const hits: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      for (const match of text.match(KEY_SHAPED) ?? []) {
        // Redacted prefixes in prose are fine (they carry an ellipsis, so they do
        // not match); a real-looking long token is not.
        hits.push(`${relative(ROOT, file)}: ${match.slice(0, 6)}…(${match.length} chars)`);
      }
    }
    assert.deepEqual(hits, [], `possible key material: ${hits.join(", ")}`);
  });

  test("no window of a real key appears anywhere in the tree", (t) => {
    const keys = realKeys();
    if (keys.length === 0) return t.skip("no real keys available to fingerprint");
    const windows = new Set<string>();
    for (const key of keys) {
      for (let i = 0; i + 12 <= key.length; i++) windows.add(key.slice(i, i + 12));
    }
    const hits: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      for (const window of windows) {
        if (text.includes(window)) hits.push(`${relative(ROOT, file)} contains a 12-char window of a real key`);
      }
    }
    assert.deepEqual([...new Set(hits)], []);
  });

  test("secret.env exists but is ignored, and node_modules is ignored", () => {
    const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    assert.match(ignore, /^secret\.env$/m);
    assert.match(ignore, /^node_modules\/$/m);
    if (existsSync(join(ROOT, "secret.env"))) {
      assert.match(ignore, /\*\.env|^secret\.env$/m, "the key file must never be committable");
    }
  });

  test("the live harness's garbage key is not a real key, and is not a literal", () => {
    const harness = readFileSync(join(ROOT, "live", "check.ts"), "utf8");
    assert.match(harness, /GARBAGE_KEY = \["ak_", "definitely", "_not_a_real_key"\]\.join/, "the placeholder must stay constructed, not pasted");
    const garbage = ["ak_", "definitely", "_not_a_real_key"].join("");
    for (const key of realKeys()) assert.notEqual(garbage, key, "the deliberately-invalid key must not collide with a real one");
  });

  test("no file the tests import contains a private path or a credential literal", () => {
    for (const file of FILES.filter((f) => f.endsWith(".ts") && !f.includes("/test/"))) {
      const text = readFileSync(file, "utf8");
      assert.equal(/Bearer\s+ak_[A-Za-z0-9]{10,}/.test(text), false, `${relative(ROOT, file)} embeds a key`);
      assert.equal(/\/Users\/[^/\s]+/.test(text), false, `${relative(ROOT, file)} hardcodes a user path`);
      assert.equal(/homedir\(\)\s*\+\s*["']\/\.pi/.test(text), false, "resolve agent dirs through pi's getAgentDir(), never homedir()");
    }
  });
});
