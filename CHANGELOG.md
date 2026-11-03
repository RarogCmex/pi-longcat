# Changelog

Entries are read by pi 1.5.0 and shown under "Extension Updates" on the first fresh
launch after the package version grows. Headings must stay in the `## [x.y.z]` form —
pi's parser (`dist/utils/changelog.js`) only recognises a version triple.

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
