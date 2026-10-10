/**
 * Offline-suite guard and loader alias.
 *
 * Loaded as a preload (`node --test --import ./test/no-network.ts`) so the whole
 * `node --test` run:
 *
 *  1. has `globalThis.fetch` replaced with a throwing stub — a test that
 *     accidentally dials the real LongCat API fails loudly instead of spending
 *     the user's prepaid balance, which makes "offline tests" a property of the
 *     suite rather than a claim about it. This matters more than usual here:
 *     every accepted call on this platform is billed (there is no zero-priced
 *     id), and a suite that reaches a *nonexistent* host does not fail fast — it
 *     hangs in a DNS blackhole (pitfalls L16);
 *  2. resolves the bare "@earendil-works/pi-ai" specifier to pi-ai's `compat`
 *     entrypoint, exactly as pi's extension loader does. Plain Node resolves it
 *     to `dist/index`, which does not export `openAICompletionsApi` /
 *     `openAIResponsesApi`, so without this mirror `index.ts` (the one
 *     pi-runtime-coupled file) could not be imported by the entry test.
 */

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@earendil-works/pi-ai") {
      return next("@earendil-works/pi-ai/compat", context);
    }
    return next(specifier, context);
  },
});

const blocked = (): never => {
  throw new Error(
    "network blocked: the offline test suite must not dial out (every accepted " +
      "LongCat call is billed). Stub `fetch` in the test, or move the check to live/check.ts.",
  );
};

globalThis.fetch = blocked as unknown as typeof fetch;
