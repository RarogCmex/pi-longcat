# Changelog

Entries are read by pi 1.5.0 and shown under "Extension Updates" on the first fresh
launch after the package version grows. Headings must stay in the `## [x.y.z]` form —
pi's parser (`dist/utils/changelog.js`) only recognises a version triple.

## [0.5.0] — 2026-11-07

**LongCat-2.5 is out, and the platform drifted in two more places while it
shipped.** The change log gained "Version: 2026-11-02 — LongCat-2.5 Now
Available"; `GET /openai/v1/models` went from two ids to three; and the
docs were rewritten around the new model — the quick start, `api/model-params`,
the FAQ and both pricing pages now name LongCat-2.5 and no longer mention
2.5-Preview or 2.0, while **both older ids are still served** (liveness
re-measured: an 8-token call on each completed).

**Verified live (2026-11-07):** free sweep `research/probe-25-ga.ts` (`GA-A*`,
`GA-B*`), vision round `research/probe-25-vision.ts` (`GA-V-*`), **¥0.1496** of billed calls
for the day's rounds (¥0.00396 for the GA sweep, ¥0.1456 for four vision runs —
the repeats are what turned one "cyan" into a rate — plus the harness runs
below); then the shipped harness end-to-end through pi's adapters —
**19/19** on the default Responses surface (¥0.0059) and **18/18** on chat
(¥0.0068); and one real `pi -p` run per surface against the GA model (a bash tool
round trip on Responses, `--thinking off` on chat) to prove the host, not just the
adapter. Offline: `npm run typecheck` clean, **185/185** tests green (4 new
assertions, 3 rewritten).

- **`LongCat-2.5` added to the catalog**, first in the list so the picker opens on
the model the platform documents: 1,048,576 window, **262,144** output cap
(measured by a 400 that named it), `text + image`, ¥2 / ¥8 / ¥0.04. Same seven
`supported_parameters` as the family, and native tool calling measured working
(`finish_reason: tool_calls`).
- **The two older ids stay registered** — they are still served and still work,
and dropping a working id because a web page stopped linking it would break users
mid-session. Their `priceNote`s now say they are undocumented-but-served.
- **Found by the free harness failing: LongCat-2.0's cap oracle is gone.**
  `max_tokens: 131073` came back **200 and billed** where it used to be a 400
  naming 131072; 262145 now 400s naming **262144**. The listing still advertises
  131072. The catalog keeps the published clamp and writes the contradiction
down (fixtures `CAP7`/`CAP8`): an accepted request proves the *validator* gave
way, not that the model emits 131,073 tokens.
- **The image-area floor relaxed from >256 px² to >200 px²** — bracket closed for
free: 64 px and 196 px rejected, **225 px accepted** (billed, ¥0.0002). The docs'
new "at least 200 px" agrees, so `MIN_IMAGE_AREA_PX` is 200.
- **The vision caveat was rewritten, and the surface story it told is dead.** The
  Responses-only defect (DD3: green read as blue/teal in 5 of 6 runs vs 4/4 on
  chat) does not reproduce as a surface difference any more: on 2026-11-07 the
  same 256×256 green png was named green in **5/15** chat runs on 2.5, **6/15** on
  Responses, **2/6** on the Preview, and a solid RED png **0/6**. What still holds
  is that the image is read: text-only runs answer "I don't see an image
  attached", tokens are billed (19 → 102 at 256², 345 at 512²), and a 512×512
  field with 2 or 3 black bars is counted correctly **4/4**. So the caveat now
  names fine colour of small images, not the surface.
- **The once-per-session image warning fires on BOTH surfaces** and no longer
  tells the user to restart with `LONGCAT_SURFACE=chat` — advice that stopped
  being true. Dedupe, `hasUI` gating and the provider guard are unchanged.
- **`video` input is advertised by LongCat-2.5 and deliberately NOT registered.**
  The gateway does parse a `video_url` block (a bogus url → 400 "Failed to
  download video from URL", on both 2.5 ids), but pi 1.5.0's `ModelInputModality`
  is exactly `["text","image"]`, so no field value could make pi send one.
- **Fixed: a persisted discovery overlay could shadow the curated row.** pi restores
  the stored overlay and merges it OVER the baseline by id, so an id that was
  unknown when the plugin last refreshed keeps the conservative shape discovery
  gave it — offline included, forever. `LongCat-2.5` was exactly that between the
  platform's 2026-11-02 release and this update: `pi --list-models` printed
  `images: no` for it while the catalog said `text + image` (measured, real host,
  2026-11-07). `buildLongCatProvider` now canonicalises curated ids through
  `filterModels` — the one hook pi applies to both the list it shows and the list
  it resolves from — and passes unknown ids through untouched. One new test pins
  both halves.
- **Harness changes**: the cap sweep now probes each id's *enforced* ceiling
  (all three at 262145) instead of its catalog clamp — probing 2.0 at its clamp
  is exactly what billed a probe on 2026-11-07 — and asserts the clamp never
  exceeds the ceiling; the billed image check asserts the bar count and only
  records the colour; liveness/thinking/tool cells run on `LongCat-2.5` with a
  cap that fits its reasoning (the GA model reasons 47–160 tokens on a trivial
  prompt, so cap 8 stops with `length` and no text).
- **Docs**: README model table regenerated (3 models), new
  `## Verification log` entry, and the fresh docs capture — including the new
  `image-video-understanding` page — in `research/doc-*.txt`.

## [0.4.0] — 2026-11-03

**The platform-wide concurrency 429 gets an explanation.** Measured, not
hypothesised: five subagents on `longcat/LongCat-2.5-Preview` ran concurrently and
the gateway answered

```
HTTP 429 {"message":"Too many concurrent responses create requests; global
concurrency limit reached (96/96)","type":"rate_limit_error","param":null,
"code":"request_rate_limited"}
```

**Verified against pi 1.5.0 (2026-11-03):** `npm run typecheck` clean,
**183/183** offline tests green (7 new). No live probe was spent — the failure is
the evidence.

- **Step 0 first.** The recorded body was driven through pi's real adapters
  (`test/errors.test.ts`, `compose()`): pi composes `429: {…}` on chat and
  `longcat API error (429): {…}` on Responses, and
  `isRetryableAssistantError === true`. So pi's classification was already correct
  — a freed slot is worth waiting for — and what was missing was the diagnosis.
- **Fixed: a body carrying only `request_rate_limited` was a non-retryable 400.**
  `statusForGatewayError` keyed 429 on `rate_limit_exceeded`/`rate_limit_error`;
  the measured envelope carries both, but a body with just the code fell through
  to 400 and pi would never retry a transient condition. The code now maps to 429
  on its own.
- **New `isConcurrencyLimitError`** — deliberately narrower than the existing
  rate-limit veto: it fires on `global concurrency limit`/`concurrency limit
  reached`/`concurren…limit|cap|ceiling|exceed`, and NOT on `rate_limit_exceeded`,
  "too many requests", or "requests per minute". The distinction is operational:
  a per-key rate limit and a saturated platform need different reactions. The
  rate-limit veto itself learned `concurren`, so a busy platform still can never
  launder into a compaction.
- **New `clarifyCapacityError`** (`message_end`): says the ceiling is the
  platform's own (96/96), that every key of the account hits the same wall, so
  rotating keys or topping up changes nothing, and that the actions that work are
  waiting for pi's retry or running fewer requests at once. Keeps `429` verbatim
  in the original text, so `isRetryableAssistantError` still says true, and is
  tagged `[longcat-capacity]` so it can never be filed under auth or balance.
- **New TUI entry `longcat-capacity-help`** (`turn_end`, deduped on customType),
  and `classifyRewritten` grew a `"capacity"` result; the three-way classification
  replaced the previous binary auth/balance branch.
- **7 new tests**: composition + retryability, the code-only status mapping, the
  narrow predicate (positives and negatives), the rewrite's contents and
  retryability, its non-interference with auth/quota/overflow, and the entry
  wiring with dedupe.

## [0.3.1] — 2026-11-03

**Re-verified against pi 1.5.0** (2026-11-03): `npm run typecheck` clean, **176/176**
offline tests green, and `pi -ne -e <repo> --offline --list-models longcat` prints the
same **3** catalog rows. Host migration only: no provider, catalog or wire behaviour
changed.

- **Fixed — the one real break in 1.5.0.** pi-ai 1.5.0 no longer re-exports TypeBox;
  pi maps an extension's `Type`/`Static`/`TSchema` import to the compat entry plus the
  TypeBox it bundles at runtime, but `tsc` sees neither, so `npm run typecheck` failed
  with `TS2305: has no exported member 'Type'` in `test/wire-format.test.ts` and
  `live/check.ts`. Both now import `Type` from `typebox` directly (the form the 1.5.0
  docs prescribe for new code), and `scripts/link-pi.mjs` links the host's bundled
  `typebox` next to pi and pi-ai. The test assertions are unchanged.
- **First `CHANGELOG.md`.** pi 1.5.0 reads `<package>/CHANGELOG.md` (or
  `pi.changelogPath`) and shows entries newer than the last seen version on the first
  fresh launch; a git package only moves when `version` grows, hence the patch bump.
  `pi.changelogPath` is not set — the file is at the package root, which pi reads by
  default.
- **Not adopted from 1.5.0, deliberately.** This package registers no tools, so the
  pi-schema validation change and its coercion rules do not reach it. `keyText()`/
  `keyHint()` need a custom tool renderer (none is registered); `blocked` on
  `ctx.ui.custom()` needs an inline custom UI (`/login longcat` uses `ui.select`/
  `ui.input`); `pi.exec()` `maxBuffer`/`truncated` is moot because `pi.exec()` is never
  called; `Usage.cost.totalFromProvider` and `responseModel` are filled by the host
  runtime; GPT-6.1 Terra, the models.dev v2 catalog and the changed host defaults are
  host catalogs, not this gateway's; MCP OAuth client registration does not apply.
  `collapseChangelog` is a host setting that starts working on its own now that the
  changelog exists.

## [0.3.0] — 2026-10-24

Warn once per session when an image is attached on the Responses surface
(`before_agent_start`, Responses-only, deduped per session, `ctx.ui.notify`). The
underlying vision defect is the documented DD3 finding; the warning tells the user to
use `LONGCAT_SURFACE=chat` for image work.

## [0.2.0] — 2026-10-24

Default surface flipped to OpenAI Responses (`LONGCAT_SURFACE=responses`); the dead `off`
thinking switch is hidden for the 2.5 family on that surface; the vision defect the
flip exposed is documented (Responses reads a green png as blue/teal in 5 of 6 runs vs
4/4 on chat).

## [0.1.1] — 2026-10-22

Re-verified on pi 1.4.0: no code change; README and source citations refreshed.

## [0.1.0] — 2026-10-11

Initial release: the LongCat provider — catalog, models, provider, errors, discovery,
index, `/login`, the `prompt_cache_key` injection, the live harness and the README
design doc.
