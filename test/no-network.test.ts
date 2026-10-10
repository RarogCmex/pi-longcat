import assert from "node:assert/strict";
import test from "node:test";

test("the no-network preload blocks global fetch", async () => {
  await assert.rejects(async () => globalThis.fetch("https://api.longcat.chat/openai/v1/models"), /network blocked/);
});

test("the preload's error names the billed-call reason, not just the rule", async () => {
  await assert.rejects(async () => globalThis.fetch("https://api.longcat.chat/openai/v1/chat/completions"), /billed/);
});
