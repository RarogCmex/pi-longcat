# Live probe ledger — pi-longcat

Generated from `research/probe-ledger.jsonl` by `node scripts/ledger-report.ts`; do not hand-edit.

Rules (pi-provider-plugin Phase 5, pitfalls L35/L41/L42):

- **Free means *rejected*.** A 2xx that generated is itemized with its usage and cost.
- A 2xx carrying an in-band `{"error":…}` body, or an SSE `response.failed` with
  `usage: 0`, performed no inference and is recorded as not billed.
- Costing uses the gateway's own rates: ¥2 / 1M uncached input, ¥0.04 / 1M cached,
  ¥8 / 1M output (`GET /openai/v1/models/{id}`, 2026-10-10). USD conversions use the
  dated house rate ¥6.7252 = $1 (models.ts).
- `key` is the index name from `secret.env`, never the key.

## Summary

| | |
|---|---|
| ledger rows | 449 |
| calls that generated (BILLED) | 290 |
| input tokens bought | 191002 |
| output tokens bought | 41277 |
| **total spend** | **¥0.661807 ≈ $0.098407** |
| accepted rows whose usage was never captured | 3 — C3b-microcoding-2.5-16k, CAP2-chat-2.5-131073, R2-IM-2.5-textonly |
| rows planned "free" that came back accepted and generated (L35 audit) | 6 — B4-bad-thinking-type-chat, B4-bad-thinking-type-anthropic, DD-A8-budget-over, DD-A9-temp-1.5, live-temperature-drift-run1, live-temperature-drift-run2 |

Rows whose usage was never captured are named above and are **not** estimated —
the house rule is "not captured" rather than a plausible number. Three classes
produce them: a client-side abort guard firing mid-generation (the cap probes,
and `C3b-microcoding-2.5-16k`, which a 120 s wall clock cut off while the model
was still thinking — its class reads BILLED-uncaptured because the server kept
generating after we hung up), a request timeout, and a stream that ended before
the usage event. A row in this list is a hole in the accounting, not a free call.
The 2 "suspicious" rows are the honest L35 misses from the first research round:
an invalid `thinking.type` planned as a guaranteed rejection and accepted+billed.

### Spend per key (the operator's cap is per key, so the ledger reports per key)

| key | rows | billed rows | input tokens | output tokens | ¥ | ~$ |
|---|---|---|---|---|---|---|
| KEY1 | 325 | 212 | 68752 | 8015 | 0.156797 | 0.023315 |
| KEY1..KEY9 | 1 | 0 | 0 | 0 | 0.000000 | 0.000000 |
| KEY1/garbage/none | 1 | 0 | 0 | 0 | 0.000000 | 0.000000 |
| KEY2 | 21 | 21 | 3884 | 1117 | 0.012188 | 0.001812 |
| KEY3 | 5 | 5 | 4804 | 801 | 0.016354 | 0.002432 |
| KEY4 | 25 | 24 | 108049 | 31065 | 0.463113 | 0.068862 |
| KEY5 | 2 | 2 | 1146 | 6 | 0.002340 | 0.000348 |
| KEY6 | 23 | 11 | 2460 | 125 | 0.005956 | 0.000886 |
| KEY7 | 1 | 1 | 14 | 4 | 0.000060 | 0.000009 |
| KEY8 | 25 | 13 | 1879 | 140 | 0.004939 | 0.000734 |
| KEY9 | 13 | 1 | 14 | 4 | 0.000060 | 0.000009 |
| garbage | 3 | 0 | 0 | 0 | 0.000000 | 0.000000 |
| none | 4 | 0 | 0 | 0 | 0.000000 | 0.000000 |

### Latency (C5: every billed call of the round records TTFT and output tok/s)

Full table: `node scripts/latency-report.ts`. Rows whose surface is `real-pi` carry
`elapsedMs` + first-stdout-byte instead of TTFT, because pi does not expose TTFT;
the two are never averaged together.

## Rows

| # | label | key | surface | HTTP | class | in | out | cached | ¥ |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `S1-chat-stream` | KEY1 | openai-completions | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 2 | `S2-responses-stream` | KEY1 | openai-responses | 200 | BILLED | 14 | 8 | – | 0.00009200 |
| 3 | `S3-anthropic-stream` | KEY1 | anthropic-messages | 200 | BILLED | 14 | 8 | – | 0.00009200 |
| 4 | `S4-responses-pi-shaped` | KEY1 | openai-responses | 200 | BILLED | 21 | 8 | – | 0.00010600 |
| 5 | `T1-thinking-enabled` | KEY1 | openai-completions | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 6 | `T2-thinking-disabled` | KEY1 | openai-completions | 200 | BILLED | 17 | 2 | 0 | 0.00005000 |
| 7 | `T3-thinking-absent` | KEY1 | openai-completions | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 8 | `T4-thinking-zai-shape` | KEY1 | openai-completions | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 9 | `T5-thinking-2.5` | KEY1 | openai-completions | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 10 | `T6-reasoning-effort` | KEY1 | openai-completions | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 11 | `T7-anthropic-thinking` | KEY1 | anthropic-messages | 200 | BILLED | 14 | 8 | – | 0.00009200 |
| 12 | `TL1-tools-chat` | KEY1 | openai-completions | 200 | BILLED | 148 | 77 | 0 | 0.00091200 |
| 13 | `TL2-tools-anthropic` | KEY1 | anthropic-messages | 200 | BILLED | 20 | 57 | 128 | 0.00024512 |
| 14 | `TL3-tool-result-role` | KEY1 | openai-completions | 200 | BILLED | 186 | 8 | 0 | 0.00043600 |
| 15 | `PA1-content-parts-array` | KEY1 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 16 | `PA2-developer-role` | KEY1 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 17 | `PA3-temperature-range` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 18 | `IM1-image-2.5-chat` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 19 | `IM2-image-2.0-chat` | KEY1 | openai-completions | 200 | BILLED | 19 | 8 | 0 | 0.00010200 |
| 20 | `CAP1-chat-2.0-131073` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 21 | `CAP2-chat-2.5-131073` | KEY1 | openai-completions | ABORTED(3000ms) | free (rejected/no inference) | – | – | – | 0 |
| 22 | `CAP3-chat-2.5-262145` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 23 | `CAP4-chat-window-plus-1` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 24 | `CAP5-anthropic-131073` | KEY1 | anthropic-messages | 400 | free (rejected/no inference) | – | – | – | 0 |
| 25 | `CAP6-responses-131073` | KEY1 | openai-responses | 200 | 200-no-usage (not billed) | 0 | 0 | – | 0 |
| 26 | `K-KEY2` | KEY2 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 27 | `K-KEY3` | KEY3 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 28 | `K-KEY4` | KEY4 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 29 | `B4-bad-thinking-type-chat` | KEY1 | openai-completions | 200 | BILLED | 11 | 4 | 0 | 0.00005400 |
| 30 | `K-KEY5` | KEY5 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 31 | `B4-bad-thinking-type-anthropic` | KEY1 | anthropic-messages | 200 | BILLED | 11 | 4 | 0 | 0.00005400 |
| 32 | `K-KEY6` | KEY6 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 33 | `listing-9-keys` | KEY1..KEY9 | GET | 200 | free (no inference) | – | – | – | 0 |
| 34 | `K-KEY7` | KEY7 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 35 | `retrieve-model-details` | KEY1 | GET | 200 | free (no inference) | – | – | – | 0 |
| 36 | `K-KEY8` | KEY8 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 37 | `path-matrix-empty-bodies` | KEY1 | multiple | 400 | free (rejected) | – | – | – | 0 |
| 38 | `K-KEY9` | KEY9 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 39 | `auth-and-model-dialect` | KEY1/garbage/none | multiple | 401 | free (rejected) | – | – | – | 0 |
| 40 | `inband-200-evidence` | KEY1 | openai-responses + GET | 200 | 200-in-band-error (not billed) | – | – | – | 0 |
| 41 | `R2-SYS-system-role` | KEY1 | openai-completions | 200 | BILLED | 57 | 4 | 0 | 0.00014600 |
| 42 | `R2-SYS-developer-role` | KEY1 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 43 | `R2-SYS-baseline` | KEY1 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 44 | `R2-IM-2.5-64px` | KEY1 | openai-completions | 200 | BILLED | 85 | 8 | 0 | 0.00023400 |
| 45 | `R2-IM-2.5-textonly` | KEY1 | openai-completions | ERR:The operation was aborted due to timeout | free (rejected/no inference) | – | – | – | 0 |
| 46 | `R2-IM-2.0-64px` | KEY1 | openai-completions | 200 | BILLED | 19 | 8 | 0 | 0.00010200 |
| 47 | `R2-IM-responses-2.5` | KEY1 | openai-responses | 200 | BILLED | 86 | 8 | 0 | 0.00023600 |
| 48 | `R2-CACHE-chat-repeat` | KEY1 | openai-completions | 200 | BILLED | 836 | 4 | 0 | 0.00170400 |
| 49 | `R2-CACHE-chat-repeat2` | KEY1 | openai-completions | 200 | BILLED | 836 | 4 | 768 | 0.00019872 |
| 50 | `R2-CACHE-chat-repeat2` | KEY1 | openai-completions | 200 | BILLED | 836 | 4 | 768 | 0.00019872 |
| 51 | `R2-CACHE-anthropic-repeat` | KEY1 | anthropic-messages | 200 | BILLED | 836 | 4 | – | 0.00170400 |
| 52 | `R3-IM-2.5-off` | KEY1 | openai-completions | 200 | BILLED | 88 | 2 | 0 | 0.00019200 |
| 53 | `R3-IM-2.0-off` | KEY1 | openai-completions | 200 | BILLED | 22 | 2 | 0 | 0.00006000 |
| 54 | `R3-IM-2.5-textonly` | KEY1 | openai-completions | 200 | BILLED | 22 | 2 | 0 | 0.00006000 |
| 55 | `R3-RESP-baseline` | KEY1 | openai-responses | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 56 | `R3-RESP-effort-none` | KEY1 | openai-responses | 200 | BILLED | 17 | 2 | 0 | 0.00005000 |
| 57 | `R3-RESP-thinking-disabled` | KEY1 | openai-responses | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 58 | `R3-ANTH-thinking-disabled` | KEY1 | anthropic-messages | 200 | BILLED | 17 | 2 | – | 0.00005000 |
| 59 | `R3-ANTH-budget` | KEY1 | anthropic-messages | 200 | BILLED | 14 | 8 | – | 0.00009200 |
| 60 | `R4-2.5-responses` | KEY1 | openai-responses | 200 | BILLED | 14 | 8 | 0 | 0.00009200 |
| 61 | `R4-2.5-anthropic` | KEY1 | anthropic-messages | 200 | BILLED | 14 | 8 | – | 0.00009200 |
| 62 | `R4-IM-blue-2.5` | KEY1 | openai-completions | 200 | BILLED | 105 | 2 | 0 | 0.00022600 |
| 63 | `R4-IM-blue-responses` | KEY1 | openai-responses | 200 | BILLED | 103 | 8 | 0 | 0.00027000 |
| 64 | `R5-IM-green-2.5` | KEY1 | openai-completions | 200 | BILLED | 105 | 2 | 0 | 0.00022600 |
| 65 | `R5-IM-red1024-2.5` | KEY1 | openai-completions | 200 | BILLED | 1393 | 2 | 0 | 0.00280200 |
| 66 | `R5-RESP-none-array` | KEY1 | openai-responses | 200 | BILLED | 17 | 2 | 0 | 0.00005000 |
| 67 | `R5-RESP-none-array-plain` | KEY1 | openai-responses | 200 | BILLED | 17 | 2 | 0 | 0.00005000 |
| 68 | `R5-RESP-none-image` | KEY1 | openai-responses | 200 | BILLED | 103 | 8 | 0 | 0.00027000 |
| 69 | `R6-IM-green-think64` | KEY1 | openai-completions | 200 | BILLED | 102 | 50 | 0 | 0.00060400 |
| 70 | `R6-IM-green-detail-high` | KEY1 | openai-completions | 200 | BILLED | 105 | 2 | 0 | 0.00022600 |
| 71 | `R6-IM-green-describe` | KEY1 | openai-completions | 200 | BILLED | 101 | 6 | 0 | 0.00025000 |
| 72 | `R7-max-completion-tokens` | KEY1 | openai-completions | 200 | BILLED | 14 | 33 | 0 | 0.00029200 |
| 73 | `R7-tool-result-no-assistant` | KEY1 | openai-completions | 200 | BILLED | 161 | 8 | 0 | 0.00038600 |
| 74 | `R7-thinking-budget` | KEY1 | openai-completions | 200 | BILLED | 20 | 64 | 0 | 0.00055200 |
| 75 | `free-stream-invalid-chat` | KEY1 | openai-completions | 400 | free (rejected) | – | – | – | 0 |
| 76 | `free-stream-invalid-responses` | KEY1 | openai-responses | 200 | 200 response.failed, usage 0 (not billed) | 0 | 0 | 0 | 0 |
| 77 | `free-stream-invalid-anthropic` | KEY1 | anthropic-messages | 400 | free (rejected) | – | – | – | 0 |
| 78 | `free-stream-auth-chat-badkey` | garbage | openai-completions | 401 | free (cannot bill) | – | – | – | 0 |
| 79 | `free-stream-auth-chat-nokey` | none | openai-completions | 401 | free (cannot bill) | – | – | – | 0 |
| 80 | `free-stream-auth-responses-badkey` | garbage | openai-responses | 401 | free (cannot bill) | – | – | – | 0 |
| 81 | `free-stream-auth-responses-nokey` | none | openai-responses | 401 | free (cannot bill) | – | – | – | 0 |
| 82 | `free-stream-auth-anthropic-badkey` | garbage | anthropic-messages | 401 | free (cannot bill) | – | – | – | 0 |
| 83 | `free-stream-auth-anthropic-nokey` | none | anthropic-messages | 401 | free (cannot bill) | – | – | – | 0 |
| 84 | `free-anthropic-xapikey` | KEY1 | anthropic-messages | 401 | free (rejected) | – | – | – | 0 |
| 85 | `free-anthropic-xapikey-noauth` | none | anthropic-messages | 401 | free (rejected) | – | – | – | 0 |
| 86 | `R8-responses-pi-exact` | KEY1 | openai-responses | 200 | BILLED | 159 | 8 | 0 | 0.00038200 |
| 87 | `R8-chat-pi-exact` | KEY1 | openai-completions | 200 | BILLED | 153 | 8 | 0 | 0.00037000 |
| 88 | `R9-tools-thinking-off` | KEY1 | openai-completions | 200 | BILLED | 157 | 16 | 0 | 0.00044200 |
| 89 | `R9-tools-thinking-on` | KEY1 | openai-completions | 200 | BILLED | 154 | 57 | 0 | 0.00076400 |
| 90 | `LIVE-free-run-1` | KEY1 | mixed | 200 | free (no inference) | – | – | – | 0 |
| 91 | `LIVE-billed-run-1` | KEY1 | openai-completions | 200 | BILLED | 582 | 68 | 256 | 0.00118600 |
| 92 | `LIVE2-liveness` | KEY1 | openai-completions | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 93 | `LIVE2-thinking-off` | KEY1 | openai-completions | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 94 | `LIVE2-thinking-on` | KEY1 | openai-completions | 200 | BILLED | 23 | 42 | 0 | 0.00038200 |
| 95 | `LIVE2-tool-roundtrip` | KEY1 | openai-completions | 200 | BILLED | 35 | 18 | – | 0.00021400 |
| 96 | `LIVE2-image-colour` | KEY1 | openai-completions | 200 | BILLED | 111 | 54 | 0 | 0.00065400 |
| 97 | `LIVE2-cache-warm` | KEY1 | openai-completions | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |
| 98 | `LIVE2-cache-hit` | KEY1 | openai-completions | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |
| 99 | `A1-cache-chat-call1` | KEY1 | openai-completions | 200 | BILLED | 1057 | 2 | 0 | 0.00213000 |
| 100 | `A1-cache-chat-call2` | KEY1 | openai-completions | 200 | BILLED | 1057 | 2 | 1024 | 0.00012296 |
| 101 | `A1-cache-chat-call3` | KEY1 | openai-completions | 200 | BILLED | 1057 | 2 | 1024 | 0.00012296 |
| 102 | `A1-cache-chat-call4` | KEY1 | openai-completions | 200 | BILLED | 1057 | 2 | 1024 | 0.00012296 |
| 103 | `A2-minprefix-6x-call1` | KEY1 | openai-completions | 200 | BILLED | 308 | 2 | 0 | 0.00063200 |
| 104 | `A2-minprefix-6x-call2` | KEY1 | openai-completions | 200 | BILLED | 308 | 2 | 256 | 0.00013024 |
| 105 | `A2-minprefix-12x-call1` | KEY1 | openai-completions | 200 | BILLED | 593 | 2 | 0 | 0.00120200 |
| 106 | `A2-minprefix-12x-call2` | KEY1 | openai-completions | 200 | BILLED | 593 | 2 | 512 | 0.00019848 |
| 107 | `A2-minprefix-24x-call1` | KEY1 | openai-completions | 200 | BILLED | 1157 | 2 | 0 | 0.00233000 |
| 108 | `B-tools-2.0-enabled-1of5` | KEY2 | openai-completions | 200 | BILLED | 192 | 150 | 0 | 0.00158400 |
| 108 | `A2-minprefix-24x-call2` | KEY1 | openai-completions | 200 | BILLED | 1157 | 2 | 1152 | 0.00007208 |
| 109 | `B-tools-2.0-enabled-2of5` | KEY2 | openai-completions | 200 | BILLED | 192 | 71 | 128 | 0.00070112 |
| 109 | `A2-minprefix-48x-call1` | KEY1 | openai-completions | 200 | BILLED | 2285 | 2 | 0 | 0.00458600 |
| 110 | `B-tools-2.0-enabled-3of5` | KEY2 | openai-completions | 200 | BILLED | 192 | 70 | 128 | 0.00069312 |
| 110 | `A2-minprefix-48x-call2` | KEY1 | openai-completions | 200 | BILLED | 2285 | 2 | 2176 | 0.00032104 |
| 111 | `B-tools-2.0-enabled-4of5` | KEY2 | openai-completions | 200 | BILLED | 192 | 157 | 128 | 0.00138912 |
| 111 | `A3-ttl-gap0` | KEY1 | openai-completions | 200 | BILLED | 1132 | 2 | 0 | 0.00228000 |
| 112 | `B-tools-2.0-enabled-5of5` | KEY2 | openai-completions | 200 | BILLED | 192 | 136 | 128 | 0.00122112 |
| 113 | `B-tools-2.0-disabled-1of5` | KEY2 | openai-completions | 200 | BILLED | 195 | 16 | 128 | 0.00026712 |
| 114 | `B-tools-2.0-disabled-2of5` | KEY2 | openai-completions | 200 | BILLED | 195 | 29 | 128 | 0.00037112 |
| 115 | `B-tools-2.0-disabled-3of5` | KEY2 | openai-completions | 200 | BILLED | 195 | 16 | 128 | 0.00026712 |
| 116 | `B-tools-2.0-disabled-4of5` | KEY2 | openai-completions | 200 | BILLED | 195 | 16 | 128 | 0.00026712 |
| 112 | `A3-ttl-gap1min` | KEY1 | openai-completions | 200 | BILLED | 1132 | 2 | 1024 | 0.00027296 |
| 117 | `B-tools-2.0-disabled-5of5` | KEY2 | openai-completions | 200 | BILLED | 195 | 16 | 128 | 0.00026712 |
| 118 | `B-tools-2.5-enabled-1of5` | KEY2 | openai-completions | 200 | BILLED | 192 | 24 | 0 | 0.00057600 |
| 119 | `B-tools-2.5-enabled-2of5` | KEY2 | openai-completions | 200 | BILLED | 192 | 65 | 128 | 0.00065312 |
| 120 | `B-tools-2.5-enabled-3of5` | KEY2 | openai-completions | 200 | BILLED | 192 | 65 | 128 | 0.00065312 |
| 121 | `B-tools-2.5-enabled-4of5` | KEY2 | openai-completions | 200 | BILLED | 192 | 79 | 128 | 0.00076512 |
| 122 | `B-tools-2.5-enabled-5of5` | KEY2 | openai-completions | 200 | BILLED | 192 | 123 | 128 | 0.00111712 |
| 123 | `B-tools-2.5-disabled-1of5` | KEY2 | openai-completions | 200 | BILLED | 195 | 16 | 128 | 0.00026712 |
| 124 | `B-tools-2.5-disabled-2of5` | KEY2 | openai-completions | 200 | BILLED | 195 | 16 | 128 | 0.00026712 |
| 125 | `B-tools-2.5-disabled-3of5` | KEY2 | openai-completions | 200 | BILLED | 195 | 16 | 128 | 0.00026712 |
| 126 | `B-tools-2.5-disabled-4of5` | KEY2 | openai-completions | 200 | BILLED | 195 | 16 | 128 | 0.00026712 |
| 127 | `C1-constraints-2.5-trial1` | KEY4 | openai-completions | 200 | BILLED | 138 | 1088 | 0 | 0.00898000 |
| 127 | `B-tools-2.5-disabled-5of5` | KEY2 | openai-completions | 200 | BILLED | 195 | 16 | 128 | 0.00026712 |
| 128 | `C1-constraints-2.5-trial2` | KEY4 | openai-completions | 200 | BILLED | 138 | 911 | 128 | 0.00731312 |
| 129 | `C1-constraints-2.5-trial3` | KEY4 | openai-completions | 200 | BILLED | 138 | 1500 | 128 | 0.01202512 |
| 113 | `A3-ttl-gap5min` | KEY1 | openai-completions | 200 | BILLED | 1132 | 2 | 1024 | 0.00027296 |
| 130 | `C1-constraints-2.0-trial1` | KEY4 | openai-completions | 200 | BILLED | 138 | 2048 | 0 | 0.01666000 |
| 131 | `C2-language-1of5` | KEY4 | openai-completions | 200 | BILLED | 19 | 70 | 0 | 0.00059800 |
| 132 | `C2-language-2of5` | KEY4 | openai-completions | 200 | BILLED | 21 | 241 | 0 | 0.00197000 |
| 133 | `C2-language-3of5` | KEY4 | openai-completions | 200 | BILLED | 20 | 300 | 0 | 0.00244000 |
| 134 | `C2-language-4of5` | KEY4 | openai-completions | 200 | BILLED | 19 | 26 | 0 | 0.00024600 |
| 135 | `C2-language-5of5` | KEY4 | openai-completions | 200 | BILLED | 18 | 262 | 0 | 0.00213200 |
| 136 | `C7-effort-none-baseline` | KEY4 | openai-completions | 200 | BILLED | 20 | 122 | 0 | 0.00101600 |
| 137 | `C7-effort-reasoning_effort-low` | KEY4 | openai-completions | 200 | BILLED | 20 | 126 | 0 | 0.00104800 |
| 138 | `C7-effort-reasoning_effort-high` | KEY4 | openai-completions | 200 | BILLED | 20 | 127 | 0 | 0.00105600 |
| 139 | `C7-effort-thinking-budget_tokens-32` | KEY4 | openai-completions | 200 | BILLED | 20 | 118 | 0 | 0.00098400 |
| 140 | `B-realpi-generation-2.0` | KEY3 | real-pi (openai-completions) | 200 | BILLED | 819 | 19 | 640 | 0.00181560 |
| 141 | `B-realpi-generation-2.5` | KEY3 | real-pi (openai-completions) | 200 | BILLED | 435 | 18 | 1024 | 0.00105496 |
| 142 | `B-realpi-toolloop-2.0` | KEY3 | real-pi (openai-completions) | 200 | BILLED | 2036 | 382 | 3200 | 0.00725600 |
| 140 | `C3-microcoding-2.5` | KEY4 | openai-completions | 200 | BILLED | 184 | 4096 | 0 | 0.03313600 |
| 143 | `B-realpi-toolloop-2.5` | KEY3 | real-pi (openai-completions) | 200 | BILLED | 1500 | 378 | 3584 | 0.00616736 |
| 141 | `C3-microcoding-2.0` | KEY4 | openai-completions | 200 | BILLED | 184 | 2500 | 0 | 0.02036800 |
| 142 | `C4-oneshot-2.5` | KEY4 | openai-completions | 200 | BILLED | 111 | 208 | 0 | 0.00188600 |
| 143 | `C4-oneshot-2.0` | KEY4 | openai-completions | 200 | BILLED | 111 | 420 | 0 | 0.00358200 |
| 144 | `C6-needle-middle` | KEY4 | openai-completions | 200 | BILLED | 53011 | 10 | 0 | 0.10610200 |
| 145 | `C6-needle-end` | KEY4 | openai-completions | 200 | BILLED | 53012 | 11 | 0 | 0.10611200 |
| 146 | `C1b-constraints-2.0-8k` | KEY4 | openai-completions | 200 | BILLED | 138 | 1359 | 128 | 0.01089712 |
| 147 | `C3b-microcoding-2.5-16k` | KEY4 | openai-completions | 200 | BILLED-uncaptured (aborted mid-generation, usage never arrived) | – | – | – | 0 |
| 148 | `C3b-microcoding-2.0-16k` | KEY4 | openai-completions | 200 | BILLED | 184 | 6403 | 128 | 0.05134112 |
| 149 | `C3c-microcoding-2.5-off-4k` | KEY4 | openai-completions | 200 | BILLED | 187 | 676 | 128 | 0.00553112 |
| 114 | `A3-ttl-gap15min` | KEY1 | openai-completions | 200 | BILLED | 1132 | 2 | 1024 | 0.00027296 |
| 115 | `A4-prompt-cache-key-alpha` | KEY1 | openai-completions | 200 | BILLED | 1132 | 2 | 0 | 0.00228000 |
| 116 | `A4-prompt-cache-key-alpha-again` | KEY1 | openai-completions | 200 | BILLED | 1132 | 2 | 1024 | 0.00027296 |
| 117 | `A4-prompt-cache-key-beta` | KEY1 | openai-completions | 200 | BILLED | 1132 | 2 | 0 | 0.00228000 |
| 118 | `A5-accounting-cold` | KEY1 | openai-completions | 200 | BILLED | 1107 | 2 | 0 | 0.00223000 |
| 119 | `A5-accounting-warm` | KEY1 | openai-completions | 200 | BILLED | 1107 | 2 | 1024 | 0.00022296 |
| 120 | `A6-responses-cache-call1` | KEY1 | openai-responses | 200 | BILLED | 1154 | 16 | 0 | 0.00243600 |
| 121 | `A6-responses-cache-call2` | KEY1 | openai-responses | 200 | BILLED | 1154 | 16 | 1152 | 0.00017808 |
| 122 | `A7-cache-thinking-call1` | KEY1 | openai-completions | 200 | BILLED | 1154 | 64 | 0 | 0.00282000 |
| 123 | `A7-cache-thinking-call2` | KEY1 | openai-completions | 200 | BILLED | 1154 | 45 | 1152 | 0.00041008 |
| 124 | `A8-cross-on-2.0` | KEY1 | openai-completions | 200 | BILLED | 1082 | 2 | 0 | 0.00218000 |
| 125 | `A9-cross-on-2.5` | KEY1 | openai-completions | 200 | BILLED | 1082 | 2 | 0 | 0.00218000 |
| 126 | `A8-2.5-cache-call1` | KEY1 | openai-completions | 200 | BILLED | 1107 | 2 | 0 | 0.00223000 |
| 127 | `A8-2.5-cache-call2` | KEY1 | openai-completions | 200 | BILLED | 1107 | 2 | 1024 | 0.00022296 |
| 150 | `C3d-microcoding-2.5-16k-600s` | KEY4 | openai-completions | 200 | BILLED | 184 | 8439 | 128 | 0.06762912 |
| 151 | `B1-cross-2.0-cold` | KEY1 | openai-completions | 200 | BILLED | 1082 | 2 | 0 | 0.00218000 |
| 152 | `B1-cross-2.0-warm` | KEY1 | openai-completions | 200 | BILLED | 1082 | 2 | 1024 | 0.00017296 |
| 153 | `B1-cross-2.5-sameprefix` | KEY1 | openai-completions | 200 | BILLED | 1082 | 2 | 0 | 0.00218000 |
| 154 | `B2-subblock-r1-call1` | KEY1 | openai-completions | 200 | BILLED | 85 | 2 | 0 | 0.00018600 |
| 155 | `B2-subblock-r1-call2` | KEY1 | openai-completions | 200 | BILLED | 85 | 2 | 0 | 0.00018600 |
| 156 | `B2-subblock-r2-call1` | KEY1 | openai-completions | 200 | BILLED | 131 | 2 | 0 | 0.00027800 |
| 157 | `B2-subblock-r2-call2` | KEY1 | openai-completions | 200 | BILLED | 131 | 2 | 128 | 0.00002712 |
| 158 | `B3-tail-call1` | KEY1 | openai-completions | 200 | BILLED | 1182 | 2 | 0 | 0.00238000 |
| 159 | `B3-tail-call2-same` | KEY1 | openai-completions | 200 | BILLED | 1182 | 2 | 1152 | 0.00012208 |
| 160 | `B3-tail-call3-changed` | KEY1 | openai-completions | 200 | BILLED | 1182 | 2 | 0 | 0.00238000 |
| 161 | `B4-key-call1` | KEY1 | openai-completions | 200 | BILLED | 1132 | 2 | 0 | 0.00228000 |
| 162 | `B4-key-call2-samekey` | KEY1 | openai-completions | 200 | BILLED | 1132 | 2 | 1024 | 0.00027296 |
| 163 | `B4-key-call3-KEY5` | KEY5 | openai-completions | 200 | BILLED | 1132 | 2 | 0 | 0.00228000 |
| 164 | `D1-keyed-alpha-Q1` | KEY1 | openai-completions | 200 | BILLED | 1107 | 2 | 0 | 0.00223000 |
| 165 | `D2-keyed-alpha-Q1-repeat` | KEY1 | openai-completions | 200 | BILLED | 1107 | 2 | 1024 | 0.00022296 |
| 166 | `D3-keyed-alpha-Q2-changedtail` | KEY1 | openai-completions | 200 | BILLED | 1107 | 2 | 1024 | 0.00022296 |
| 167 | `D4-nokey-Q1` | KEY1 | openai-completions | 200 | BILLED | 1107 | 2 | 0 | 0.00223000 |
| 168 | `D5-keyed-beta-Q1` | KEY1 | openai-completions | 200 | BILLED | 1107 | 2 | 0 | 0.00223000 |
| 0 | `live/listing` | KEY6 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.5-Preview` | KEY6 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.0` | KEY6 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.5-Preview` | KEY6 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.0` | KEY6 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/unknown-model` | KEY6 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/temperature-range` | KEY6 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/image-floor` | KEY6 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/garbage-key` | KEY6 | openai-completions | 401 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-retrieve` | KEY6 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-responses` | KEY6 | openai-responses | 200 | 200-no-generation (not billed) | – | – | – | 0 |
| 0 | `live/overflow-probe (not run)` | KEY6 | openai-completions | not-sent | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/liveness` | KEY6 | openai-completions | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-off` | KEY6 | openai-completions | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-on` | KEY6 | openai-completions | 200 | BILLED | 23 | 38 | 0 | 0.00035000 |
| 0 | `live/tool-roundtrip` | KEY6 | openai-completions | 200 | BILLED | 173 | 16 | 0 | 0.00047400 |
| 0 | `live/image-colour` | KEY6 | openai-completions | 200 | BILLED | 111 | 53 | 0 | 0.00064600 |
| 0 | `live/cache-key-warm` | KEY6 | openai-completions | 200 | BILLED | 755 | 2 | 0 | 0.00152600 |
| 0 | `live/cache-key-changed-tail` | KEY6 | openai-completions | 200 | BILLED | 115 | 2 | 640 | 0.00027160 |
| 0 | `live/cache-key-control-unkeyed` | KEY6 | openai-completions | 200 | BILLED | 755 | 2 | 0 | 0.00152600 |
| 0 | `live/cache-warm` | KEY6 | openai-completions | 200 | BILLED | 359 | 2 | 0 | 0.00073400 |
| 0 | `live/cache-hit` | KEY6 | openai-completions | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |
| 0 | `live/listing` | KEY8 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.5-Preview` | KEY8 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.0` | KEY8 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.5-Preview` | KEY8 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.0` | KEY8 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/unknown-model` | KEY8 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/temperature-range` | KEY8 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/image-floor` | KEY8 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/garbage-key` | KEY8 | openai-responses | 401 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-retrieve` | KEY8 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-responses` | KEY8 | openai-responses | 200 | 200-no-generation (not billed) | – | – | – | 0 |
| 0 | `live/overflow-probe (not run)` | KEY8 | openai-responses | not-sent | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/liveness` | KEY8 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-off` | KEY8 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-on` | KEY8 | openai-responses | 200 | BILLED | 23 | 24 | 0 | 0.00023800 |
| 0 | `live/tool-roundtrip` | KEY8 | openai-responses | 200 | BILLED | 179 | 16 | 0 | 0.00048600 |
| 0 | `live/image-colour` | KEY8 | openai-responses | 200 | BILLED | 112 | 53 | 0 | 0.00064800 |
| 0 | `live/cache-key-warm` | KEY8 | openai-responses | 200 | BILLED | 756 | 2 | 0 | 0.00152800 |
| 0 | `live/cache-key-changed-tail` | KEY8 | openai-responses | 200 | BILLED | 116 | 2 | 640 | 0.00027360 |
| 0 | `live/cache-key-control-unkeyed` | KEY8 | openai-responses | 200 | BILLED | 116 | 2 | 640 | 0.00027360 |
| 0 | `live/cache-warm` | KEY8 | openai-responses | 200 | BILLED | 359 | 2 | 0 | 0.00073400 |
| 0 | `live/cache-hit` | KEY8 | openai-responses | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |
| 0 | `live/responses-off` | KEY8 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/responses-on` | KEY8 | openai-responses | 200 | BILLED | 23 | 27 | 0 | 0.00026200 |
| 0 | `live/listing` | KEY9 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.5-Preview` | KEY9 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.0` | KEY9 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.5-Preview` | KEY9 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.0` | KEY9 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/unknown-model` | KEY9 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/temperature-range` | KEY9 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/image-floor` | KEY9 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/garbage-key` | KEY9 | openai-completions | 401 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-retrieve` | KEY9 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-responses` | KEY9 | openai-responses | 200 | 200-no-generation (not billed) | – | – | – | 0 |
| 0 | `live/overflow-probe (not run)` | KEY9 | openai-completions | not-sent | free (rejected/no inference) | – | – | – | 0 |
| 169 | `DD-A1-listing` | KEY1 | GET | 200 | 200-no-generation (not billed) | – | – | – | 0 |
| 170 | `DD-A2-detail-2.5` | KEY1 | GET | 200 | 200-no-generation (not billed) | – | – | – | 0 |
| 171 | `DD-A3-detail-2.0` | KEY1 | GET | 200 | 200-no-generation (not billed) | – | – | – | 0 |
| 172 | `DD-A4-topp-2` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 173 | `DD-A5-topk-101` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 174 | `DD-A6-reppen-1.6` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 175 | `DD-A7-multi-violation` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 176 | `DD-A8-budget-over` | KEY1 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 177 | `DD-A9-temp-1.5` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 178 | `DD-A9-temp-1.5` | KEY1 | openai-completions | 200 | BILLED | 14 | 4 | 0 | 0.00006000 |
| 179 | `DD-B1-budget32` | KEY1 | openai-completions | 200 | BILLED | 38 | 151 | 0 | 0.00128400 |
| 180 | `DD-B2-nobudget` | KEY1 | openai-completions | 200 | BILLED | 38 | 178 | 0 | 0.00150000 |
| 181 | `DD-B3-budget256` | KEY1 | openai-completions | 200 | BILLED | 38 | 229 | 0 | 0.00190800 |
| 182 | `DD-B4-off-budget32` | KEY1 | openai-completions | 200 | BILLED | 41 | 5 | 0 | 0.00012200 |
| 183 | `DD-B5-effort-none` | KEY1 | openai-responses | 200 | BILLED | 38 | 168 | 0 | 0.00142000 |
| 184 | `DD-B5-effort-minimal` | KEY1 | openai-responses | 200 | BILLED | 38 | 184 | 0 | 0.00154800 |
| 185 | `DD-B5-effort-low` | KEY1 | openai-responses | 200 | BILLED | 38 | 132 | 0 | 0.00113200 |
| 186 | `DD-B5-effort-medium` | KEY1 | openai-responses | 200 | BILLED | 38 | 53 | 0 | 0.00050000 |
| 187 | `DD-B5-effort-high` | KEY1 | openai-responses | 200 | BILLED | 38 | 163 | 0 | 0.00138000 |
| 188 | `DD-B5-effort-xhigh` | KEY1 | openai-responses | 200 | BILLED | 38 | 152 | 0 | 0.00129200 |
| 189 | `DD-B6-effort20-none` | KEY1 | openai-responses | 200 | BILLED | 41 | 5 | 0 | 0.00012200 |
| 190 | `DD-B6-effort20-low` | KEY1 | openai-responses | 200 | BILLED | 38 | 125 | 0 | 0.00107600 |
| 191 | `DD-B7-resp25-thinking-disabled` | KEY1 | openai-responses | 200 | BILLED | 38 | 306 | 0 | 0.00252400 |
| 192 | `DD-B8-resp25-effortnone-thinking-disabled` | KEY1 | openai-responses | 200 | BILLED | 38 | 132 | 0 | 0.00113200 |
| 193 | `DD-C1-c3-budgeted` | KEY1 | openai-completions | 200 | BILLED | 184 | 2336 | 0 | 0.01905600 |
| 194 | `DD-C1-score` | KEY1 | local | n/a | free (rejected/no inference) | – | – | – | 0 |
| 195 | `DD-C2-c3-thinking-off` | KEY1 | openai-completions | 200 | BILLED | 187 | 1165 | 128 | 0.00944312 |
| 196 | `DD-C2-score` | KEY1 | local | n/a | free (rejected/no inference) | – | – | – | 0 |
| 197 | `live-temperature-drift-run1` | KEY1 | openai-completions | 200 | BILLED | 20 | 4 | 0 | 0.00004800 |
| 198 | `live-temperature-drift-run2` | KEY1 | openai-completions | 200 | BILLED | 20 | 4 | 0 | 0.00004800 |
| 0 | `live/listing` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.5-Preview` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.0` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.5-Preview` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.0` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/unknown-model` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/top-p-range` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/image-floor` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/garbage-key` | KEY1 | openai-completions | 401 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-retrieve` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-responses` | KEY1 | openai-responses | 200 | 200-no-generation (not billed) | – | – | – | 0 |
| 0 | `live/overflow-probe (not run)` | KEY1 | openai-completions | not-sent | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/liveness` | KEY1 | openai-completions | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-off` | KEY1 | openai-completions | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-on` | KEY1 | openai-completions | 200 | BILLED | 23 | 31 | 0 | 0.00029400 |
| 0 | `live/temperature-override` | KEY1 | openai-completions | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/tool-roundtrip` | KEY1 | openai-completions | 200 | BILLED | 173 | 16 | 0 | 0.00047400 |
| 0 | `live/image-colour` | KEY1 | openai-completions | 200 | BILLED | 111 | 42 | 0 | 0.00055800 |
| 0 | `live/cache-key-warm` | KEY1 | openai-completions | 200 | BILLED | 756 | 2 | 0 | 0.00152800 |
| 0 | `live/cache-key-changed-tail` | KEY1 | openai-completions | 200 | BILLED | 116 | 2 | 640 | 0.00027360 |
| 0 | `live/cache-key-control-unkeyed` | KEY1 | openai-completions | 200 | BILLED | 756 | 2 | 0 | 0.00152800 |
| 0 | `live/cache-warm` | KEY1 | openai-completions | 200 | BILLED | 359 | 2 | 0 | 0.00073400 |
| 0 | `live/cache-hit` | KEY1 | openai-completions | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |
| 0 | `live/listing` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.5-Preview` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.0` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.5-Preview` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.0` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/unknown-model` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/top-p-range` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/image-floor` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/garbage-key` | KEY1 | openai-responses | 401 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-retrieve` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-responses` | KEY1 | openai-responses | 200 | 200-no-generation (not billed) | – | – | – | 0 |
| 0 | `live/overflow-probe (not run)` | KEY1 | openai-responses | not-sent | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/liveness` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-off` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-on` | KEY1 | openai-responses | 200 | BILLED | 23 | 45 | 0 | 0.00040600 |
| 0 | `live/temperature-override` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/tool-roundtrip` | KEY1 | openai-responses | 200 | BILLED | 179 | 16 | 0 | 0.00048600 |
| 0 | `live/image-colour` | KEY1 | openai-responses | 200 | BILLED | 112 | 52 | 0 | 0.00064000 |
| 0 | `live/cache-key-warm` | KEY1 | openai-responses | 200 | BILLED | 757 | 2 | 0 | 0.00153000 |
| 0 | `live/cache-key-changed-tail` | KEY1 | openai-responses | 200 | BILLED | 117 | 2 | 640 | 0.00027560 |
| 0 | `live/cache-key-control-unkeyed` | KEY1 | openai-responses | 200 | BILLED | 117 | 2 | 640 | 0.00027560 |
| 0 | `live/cache-warm` | KEY1 | openai-responses | 200 | BILLED | 359 | 2 | 0 | 0.00073400 |
| 0 | `live/cache-hit` | KEY1 | openai-responses | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |
| 0 | `live/responses-off` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/responses-on` | KEY1 | openai-responses | 200 | BILLED | 23 | 30 | 0 | 0.00028600 |
| 199 | `DD2-M1-turn1` | KEY1 | openai-responses | 200 | BILLED | 185 | 41 | 0 | 0.00069800 |
| 200 | `DD2-M2-turn2` | KEY1 | openai-responses | 200 | BILLED | 260 | 46 | 0 | 0.00088800 |
| 201 | `DD2-payload-analysis` | KEY1 | local | n/a | free (rejected/no inference) | – | – | – | 0 |
| 202 | `DD2-M1-turn1` | KEY1 | openai-responses | 200 | BILLED | 57 | 46 | 128 | 0.00048712 |
| 203 | `DD2-M2-turn2` | KEY1 | openai-responses | 200 | BILLED | 265 | 69 | 0 | 0.00108200 |
| 204 | `DD2-payload-analysis` | KEY1 | local | n/a | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/listing` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.5-Preview` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.0` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.5-Preview` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.0` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/unknown-model` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/top-p-range` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/image-floor` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/garbage-key` | KEY1 | openai-responses | 401 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-retrieve` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-responses` | KEY1 | openai-responses | 200 | 200-no-generation (not billed) | – | – | – | 0 |
| 0 | `live/overflow-probe (not run)` | KEY1 | openai-responses | not-sent | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/listing` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.5-Preview` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.0` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.5-Preview` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.0` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/unknown-model` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/top-p-range` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/image-floor` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/garbage-key` | KEY1 | openai-responses | 401 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-retrieve` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-responses` | KEY1 | openai-responses | 200 | 200-no-generation (not billed) | – | – | – | 0 |
| 0 | `live/overflow-probe (not run)` | KEY1 | openai-responses | not-sent | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/liveness` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-off` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-on` | KEY1 | openai-responses | 200 | BILLED | 23 | 35 | 0 | 0.00032600 |
| 0 | `live/temperature-override` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/tool-roundtrip` | KEY1 | openai-responses | 200 | BILLED | 51 | 16 | 128 | 0.00023512 |
| 0 | `live/image-colour` | KEY1 | openai-responses | 200 | BILLED | 112 | 64 | 0 | 0.00073600 |
| 0 | `live/cache-key-warm` | KEY1 | openai-responses | 200 | BILLED | 757 | 2 | 0 | 0.00153000 |
| 0 | `live/cache-key-changed-tail` | KEY1 | openai-responses | 200 | BILLED | 117 | 3 | 640 | 0.00028360 |
| 0 | `live/cache-key-control-unkeyed` | KEY1 | openai-responses | 200 | BILLED | 117 | 2 | 640 | 0.00027560 |
| 0 | `live/cache-warm` | KEY1 | openai-responses | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |
| 0 | `live/cache-hit` | KEY1 | openai-responses | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |
| 0 | `live/responses-off` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/responses-on` | KEY1 | openai-responses | 200 | BILLED | 23 | 37 | 0 | 0.00034200 |
| 0 | `live/listing` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.5-Preview` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.0` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.5-Preview` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.0` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/unknown-model` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/top-p-range` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/image-floor` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/garbage-key` | KEY1 | openai-responses | 401 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-retrieve` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-responses` | KEY1 | openai-responses | 200 | 200-no-generation (not billed) | – | – | – | 0 |
| 0 | `live/overflow-probe (not run)` | KEY1 | openai-responses | not-sent | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/liveness` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-off` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-on` | KEY1 | openai-responses | 200 | BILLED | 23 | 18 | 0 | 0.00019000 |
| 0 | `live/temperature-override` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/tool-roundtrip` | KEY1 | openai-responses | 200 | BILLED | 51 | 29 | 128 | 0.00033912 |
| 0 | `live/image-colour` | KEY1 | openai-responses | 200 | BILLED | 112 | 39 | 0 | 0.00053600 |
| 0 | `live/cache-key-warm` | KEY1 | openai-responses | 200 | BILLED | 758 | 2 | 0 | 0.00153200 |
| 0 | `live/cache-key-changed-tail` | KEY1 | openai-responses | 200 | BILLED | 118 | 2 | 640 | 0.00027760 |
| 0 | `live/cache-key-control-unkeyed` | KEY1 | openai-responses | 200 | BILLED | 118 | 3 | 640 | 0.00028560 |
| 0 | `live/cache-warm` | KEY1 | openai-responses | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |
| 0 | `live/cache-hit` | KEY1 | openai-responses | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |
| 0 | `live/responses-off` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/responses-on` | KEY1 | openai-responses | 200 | BILLED | 23 | 46 | 0 | 0.00041400 |
| 205 | `DD3-IR1-responses` | KEY1 | openai-responses | 200 | BILLED | 103 | 128 | 0 | 0.00123000 |
| 206 | `DD3-IR2-responses` | KEY1 | openai-responses | 200 | BILLED | 103 | 63 | 0 | 0.00071000 |
| 207 | `DD3-IR3-responses` | KEY1 | openai-responses | 200 | BILLED | 103 | 55 | 0 | 0.00064600 |
| 208 | `DD3-IR4-chat` | KEY1 | openai-completions | 200 | BILLED | 102 | 116 | 0 | 0.00113200 |
| 209 | `DD3-IR5-chat` | KEY1 | openai-completions | 200 | BILLED | 102 | 76 | 0 | 0.00081200 |
| 0 | `live/listing` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.5-Preview` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.0` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.5-Preview` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.0` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/unknown-model` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/top-p-range` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/image-floor` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/garbage-key` | KEY1 | openai-responses | 401 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-retrieve` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-responses` | KEY1 | openai-responses | 200 | 200-no-generation (not billed) | – | – | – | 0 |
| 0 | `live/overflow-probe (not run)` | KEY1 | openai-responses | not-sent | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/liveness` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-off` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-on` | KEY1 | openai-responses | 200 | BILLED | 23 | 30 | 0 | 0.00028600 |
| 0 | `live/temperature-override` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/tool-roundtrip` | KEY1 | openai-responses | 200 | BILLED | 51 | 16 | 128 | 0.00023512 |
| 0 | `live/cache-key-warm` | KEY1 | openai-responses | 200 | BILLED | 756 | 2 | 0 | 0.00152800 |
| 0 | `live/cache-key-changed-tail` | KEY1 | openai-responses | 200 | BILLED | 116 | 2 | 640 | 0.00027360 |
| 0 | `live/cache-key-control-unkeyed` | KEY1 | openai-responses | 200 | BILLED | 116 | 2 | 640 | 0.00027360 |
| 0 | `live/cache-warm` | KEY1 | openai-responses | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |
| 0 | `live/cache-hit` | KEY1 | openai-responses | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |
| 0 | `live/responses-off` | KEY1 | openai-responses | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/responses-on` | KEY1 | openai-responses | 200 | BILLED | 23 | 45 | 0 | 0.00040600 |
| 0 | `live/listing` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.5-Preview` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/retrieve/LongCat-2.0` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.5-Preview` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/cap-sweep/LongCat-2.0` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/unknown-model` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/top-p-range` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/image-floor` | KEY1 | openai-completions | 400 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/garbage-key` | KEY1 | openai-completions | 401 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-retrieve` | KEY1 | GET | 200 | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/inband-responses` | KEY1 | openai-responses | 200 | 200-no-generation (not billed) | – | – | – | 0 |
| 0 | `live/overflow-probe (not run)` | KEY1 | openai-completions | not-sent | free (rejected/no inference) | – | – | – | 0 |
| 0 | `live/liveness` | KEY1 | openai-completions | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-off` | KEY1 | openai-completions | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/thinking-on` | KEY1 | openai-completions | 200 | BILLED | 23 | 43 | 0 | 0.00039000 |
| 0 | `live/temperature-override` | KEY1 | openai-completions | 200 | BILLED | 26 | 2 | 0 | 0.00006800 |
| 0 | `live/tool-roundtrip` | KEY1 | openai-completions | 200 | BILLED | 173 | 16 | 0 | 0.00047400 |
| 0 | `live/image-colour` | KEY1 | openai-completions | 200 | BILLED | 111 | 60 | 0 | 0.00070200 |
| 0 | `live/cache-key-warm` | KEY1 | openai-completions | 200 | BILLED | 756 | 2 | 0 | 0.00152800 |
| 0 | `live/cache-key-changed-tail` | KEY1 | openai-completions | 200 | BILLED | 116 | 2 | 640 | 0.00027360 |
| 0 | `live/cache-key-control-unkeyed` | KEY1 | openai-completions | 200 | BILLED | 756 | 2 | 0 | 0.00152800 |
| 0 | `live/cache-warm` | KEY1 | openai-completions | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |
| 0 | `live/cache-hit` | KEY1 | openai-completions | 200 | BILLED | 103 | 2 | 256 | 0.00023224 |

## What each row was for

- **1 `S1-chat-stream`** (max_tokens 8, 6-word prompt) — chat surface liveness, SSE dialect, usage, echoed model, finish_reason
- **2 `S2-responses-stream`** (max_output_tokens 8, 6-word prompt, abort 3 s) — does the UNDOCUMENTED Responses surface generate at all?
- **3 `S3-anthropic-stream`** (max_tokens 8, 6-word prompt) — Anthropic surface liveness + SSE dialect
- **4 `S4-responses-pi-shaped`** (max_output_tokens 8, abort 3 s) — pi's real Responses body: store:false + prompt_cache_key + reasoning{effort,summary} + instructions
- **5 `T1-thinking-enabled`** (max_tokens 8) — thinking {"type":"enabled"} — is reasoning_content / reasoning_tokens produced?
- **6 `T2-thinking-disabled`** (max_tokens 8) — thinking {"type":"disabled"} — off-switch readout
- **7 `T3-thinking-absent`** (max_tokens 8) — no thinking field at all — is thinking ON by default?
- **8 `T4-thinking-zai-shape`** (max_tokens 8) — pi's zai wire shape: thinking {type:enabled, clear_thinking:false} — accepted or rejected?
- **9 `T5-thinking-2.5`** (max_tokens 8) — thinking enabled on LongCat-2.5-Preview (per-model thinking check)
- **10 `T6-reasoning-effort`** (max_tokens 8) — OpenAI-style reasoning_effort (not in supported_parameters) — accepted/ignored/rejected?
- **11 `T7-anthropic-thinking`** (max_tokens 8) — Anthropic surface: LongCat's thinking object vs Anthropic's budget_tokens shape
- **12 `TL1-tools-chat`** (max_tokens 200, tool_choice forced) — chat: does it emit tool_calls? (shape observable only if the tool is required)
- **13 `TL2-tools-anthropic`** (max_tokens 200, tool_choice forced) — Anthropic surface: tool_use block emitted?
- **14 `TL3-tool-result-role`** (max_tokens 8) — is role:'tool' accepted? (docs list only system|user|assistant) — decides the payload hook
- **15 `PA1-content-parts-array`** (max_tokens 4) — content as a parts array (pi's shape) vs the documented string — S28 discriminator
- **16 `PA2-developer-role`** (max_tokens 4) — role:'developer' accepted? (decides supportsDeveloperRole)
- **17 `PA3-temperature-range`** (max_tokens 4) — temperature 1.5 vs the documented 0~1 range — strictness readout
- **18 `IM1-image-2.5-chat`** (max_tokens 8, 8×8 generated red PNG) — image_url OBJECT form on 2.5-Preview + a modality-only question (L40: prove consumption)
- **19 `IM2-image-2.0-chat`** (max_tokens 8, same generated PNG) — control: 2.0 is listed text-only — rejected, or accepted-and-dropped?
- **20 `CAP1-chat-2.0-131073`** (max_tokens 131073, 6-word prompt, stream + 3 s abort) — output cap of 2.0: listing says 131072 ⇒ window+1 should be rejected with the ceiling
- **21 `CAP2-chat-2.5-131073`** (max_tokens 131073, stream + 3 s abort) — 2.5-Preview at 131073: discriminates the FAQ's 128k from the listing's 262144
- **22 `CAP3-chat-2.5-262145`** (max_tokens 262145, stream + 3 s abort) — 2.5-Preview at listing cap + 1 (262145)
- **23 `CAP4-chat-window-plus-1`** (max_tokens 1048576, stream + 3 s abort) — context window: tiny prompt + max_tokens 1048576 ⇒ prompt+max_tokens > 1M window; FAQ promises context_length_exceeded
- **24 `CAP5-anthropic-131073`** (max_tokens 131073, stream + 3 s abort) — is the cap validated per surface? (Anthropic route)
- **25 `CAP6-responses-131073`** (max_output_tokens 131073, stream + 3 s abort) — is the cap validated on the Responses surface?
- **26 `K-KEY2`** (max_tokens 4, 6-word prompt) — KEY2: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **27 `K-KEY3`** (max_tokens 4, 6-word prompt) — KEY3: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **28 `K-KEY4`** (max_tokens 4, 6-word prompt) — KEY4: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **29 `B4-bad-thinking-type-chat`** (max_tokens 4, 1-word prompt) — does the gateway validate the thinking vocabulary? (planned as a guaranteed rejection: {"type":"bogus"})
- **30 `K-KEY5`** (max_tokens 4, 6-word prompt) — KEY5: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **31 `B4-bad-thinking-type-anthropic`** (max_tokens 4, 1-word prompt) — same probe on the Anthropic surface
- **32 `K-KEY6`** (max_tokens 4, 6-word prompt) — KEY6: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **33 `listing-9-keys`** (GET only, no inference) — key x listing matrix: nine keys, identical two-model list
- **34 `K-KEY7`** (max_tokens 4, 6-word prompt) — KEY7: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **35 `retrieve-model-details`** (GET only) — GET /models/{id} for both ids: modalities, context_length, CNY pricing object
- **36 `K-KEY8`** (max_tokens 4, 6-word prompt) — KEY8: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **37 `path-matrix-empty-bodies`** (empty body {} cannot be accepted) — which routes exist: chat, responses, anthropic, native (404), embeddings (404), bogus (404)
- **38 `K-KEY9`** (max_tokens 4, 6-word prompt) — KEY9: call-level entitlement (403 insufficient_quota vs 200) — one account or nine?
- **39 `auth-and-model-dialect`** (invalid credential / unknown id / negative max_tokens) — 401 invalid_api_key wording, unknown-model 400 wording, validation order (auth > model > params)
- **40 `inband-200-evidence`** (negative max_output_tokens / unknown model id) — confirm HTTP 200 + in-band error bodies (headers dumped)
- **41 `R2-SYS-system-role`** (max_tokens<=8, tiny prompt, 45 s timeout) — control: is role:'system' counted? (prompt_tokens delta vs R2-SYS-baseline)
- **42 `R2-SYS-developer-role`** (max_tokens<=8, tiny prompt, 45 s timeout) — same 50+-token message as role:'developer' — if prompt_tokens matches the baseline, the role is dropped
- **43 `R2-SYS-baseline`** (max_tokens<=8, tiny prompt, 45 s timeout) — baseline: user message only, no system/developer message
- **44 `R2-IM-2.5-64px`** (max_tokens<=8, tiny prompt, 45 s timeout) — 2.5-Preview with a valid 64×64 red PNG: does it say 'red'? are image_tokens > 0?
- **45 `R2-IM-2.5-textonly`** (max_tokens<=8, tiny prompt, 45 s timeout) — text-only control for the identical prompt on 2.5-Preview (input_tokens delta = image cost)
- **46 `R2-IM-2.0-64px`** (max_tokens<=8, tiny prompt, 45 s timeout) — control: 2.0 is listed text-only — rejected, or accepted-and-dropped (L40)?
- **47 `R2-IM-responses-2.5`** (max_tokens<=8, tiny prompt, 45 s timeout) — Responses surface image shape: input_image with image_url as a STRING (S31)
- **48 `R2-CACHE-chat-repeat`** (max_tokens<=8, tiny prompt, 45 s timeout) — does the chat surface ever report prompt_tokens_details.cached_tokens > 0 for a repeated prefix?
- **49 `R2-CACHE-chat-repeat2`** (max_tokens<=8, tiny prompt, 45 s timeout) — second identical long-prefix chat call: the pair is what proves cache accounting (a single call cannot)
- **50 `R2-CACHE-chat-repeat2`** (max_tokens<=8, tiny prompt, 45 s timeout) — second identical long-prefix chat call: the PAIR is what proves cache accounting (one call cannot)
- **51 `R2-CACHE-anthropic-repeat`** (max_tokens<=8, tiny prompt, 45 s timeout) — Anthropic surface cache accounting (round 1 reported cache_read_input_tokens: 128 unprompted)
- **52 `R3-IM-2.5-off`** (max_tokens<=8, tiny prompt, 45 s timeout) — 2.5-Preview + 64x64 red PNG + thinking disabled: visible one-word colour answer (L40 consumption proof)
- **53 `R3-IM-2.0-off`** (max_tokens<=8, tiny prompt, 45 s timeout) — control: same image on text-only 2.0 with thinking disabled — what does a model that got no image say?
- **54 `R3-IM-2.5-textonly`** (max_tokens<=8, tiny prompt, 45 s timeout) — text-only control for IMG_Q (round 2 timed out): input_tokens delta = the image's token cost
- **55 `R3-RESP-baseline`** (max_tokens<=8, tiny prompt, 45 s timeout) — Responses baseline: no thinking field — reasoning_tokens with thinking on by default
- **56 `R3-RESP-effort-none`** (max_tokens<=8, tiny prompt, 45 s timeout) — Responses off-switch candidate 1: reasoning:{effort:"none"} — does reasoning_tokens go to 0?
- **57 `R3-RESP-thinking-disabled`** (max_tokens<=8, tiny prompt, 45 s timeout) — Responses off-switch candidate 2: undocumented thinking:{type:disabled} pass-through
- **58 `R3-ANTH-thinking-disabled`** (max_tokens<=8, tiny prompt, 45 s timeout) — Anthropic surface: is thinking:{type:disabled} honoured (no thinking block)?
- **59 `R3-ANTH-budget`** (max_tokens<=8, tiny prompt, 45 s timeout) — Anthropic surface: pi's own shape thinking:{type:enabled,budget_tokens} — accepted, and does the budget bind?
- **60 `R4-2.5-responses`** (max_tokens<=8, tiny prompt, 45 s timeout) — matrix cell: LongCat-2.5-Preview on the Responses surface
- **61 `R4-2.5-anthropic`** (max_tokens<=8, tiny prompt, 45 s timeout) — matrix cell: LongCat-2.5-Preview on the Anthropic surface
- **62 `R4-IM-blue-2.5`** (max_tokens<=8, tiny prompt, 45 s timeout) — vision proof: BLUE 256x256 PNG, thinking off, one-word answer — 'Blue' can only come from the image
- **63 `R4-IM-blue-responses`** (max_tokens<=8, tiny prompt, 45 s timeout) — same blue image on the Responses surface (image_url as a STRING) — cross-surface vision check
- **64 `R5-IM-green-2.5`** (max_tokens<=8, tiny prompt, 45 s timeout) — vision decider: GREEN 256x256, thinking off — 'Green' can only come from the image
- **65 `R5-IM-red1024-2.5`** (max_tokens<=8, tiny prompt, 45 s timeout) — vision at 1024x1024 red, thinking off — does size change the answer?
- **66 `R5-RESP-none-array`** (max_tokens<=8, tiny prompt, 45 s timeout) — off switch with pi's ARRAY input shape (no image): does effort:none still zero reasoning_tokens?
- **67 `R5-RESP-none-array-plain`** (max_tokens<=8, tiny prompt, 45 s timeout) — off switch with array input whose content is a plain string (isolates 'array' from 'parts')
- **68 `R5-RESP-none-image`** (max_tokens<=8, tiny prompt, 45 s timeout) — re-run of round 4's ambiguous cell: array input + green image + effort:none
- **69 `R6-IM-green-think64`** (max_tokens<=8, tiny prompt, 45 s timeout) — green 256x256 with thinking ENABLED and max_tokens 64 — does budget change the answer?
- **70 `R6-IM-green-detail-high`** (max_tokens<=8, tiny prompt, 45 s timeout) — same image with detail:'high' (pi omits detail by default), thinking off, max_tokens 8
- **71 `R6-IM-green-describe`** (max_tokens<=8, tiny prompt, 45 s timeout) — open question instead of a forced colour word: 'Describe this image in five words' with thinking off, max_tokens 32
- **72 `R7-max-completion-tokens`** (max_tokens<=8, tiny prompt, 45 s timeout) — is max_completion_tokens read at all? (pi's default field for unknown hosts)
- **73 `R7-tool-result-no-assistant`** (max_tokens<=8, tiny prompt, 45 s timeout) — role:'tool' with NO preceding assistant tool_calls message — 400 or accepted?
- **74 `R7-thinking-budget`** (max_tokens<=8, tiny prompt, 45 s timeout) — does thinking.budget_tokens bound reasoning_tokens? (shared max_tokens budget trap)
- **75 `free-stream-invalid-chat`** (negative value, cannot be accepted) — streaming + max_tokens:-1 — is a stream failure in-band?
- **76 `free-stream-invalid-responses`** (invalid value; arrived as SSE response.failed with usage 0) — streaming + max_output_tokens:-1 — the Responses surface does NOT pre-validate
- **77 `free-stream-invalid-anthropic`** (negative value, cannot be accepted) — streaming + max_tokens:-1
- **78 `free-stream-auth-chat-badkey`** (invalid credential cannot be billed) — S32 scenario: does a streaming auth failure arrive as HTTP 200?
- **79 `free-stream-auth-chat-nokey`** (no credential) — same, no Authorization header
- **80 `free-stream-auth-responses-badkey`** (invalid credential) — S32 scenario on the Responses surface
- **81 `free-stream-auth-responses-nokey`** (no credential) — same, no header
- **82 `free-stream-auth-anthropic-badkey`** (invalid credential) — S32 scenario on the Anthropic surface
- **83 `free-stream-auth-anthropic-nokey`** (no credential) — same, no header
- **84 `free-anthropic-xapikey`** (empty body, cannot be accepted) — does the Anthropic surface accept pi's x-api-key header?
- **85 `free-anthropic-xapikey-noauth`** (empty body) — control: same empty body without any credential
- **86 `R8-responses-pi-exact`** (max_output_tokens 8, captured via onPayload then sent live) — pi's EXACT captured Responses body, incl. the unprobed include/store/prompt_cache_key/summary fields
- **87 `R8-chat-pi-exact`** (max_tokens 8, captured via onPayload then sent live) — pi's EXACT captured chat body, incl. thinking{type:enabled,clear_thinking:false} + tools
- **88 `R9-tools-thinking-off`** (max_tokens 120, one tool, no tool_choice) — do structured tool_calls survive thinking:{type:disabled}? (the harness had shown an inline <longcat_tool_call> text tag)
- **89 `R9-tools-thinking-on`** (max_tokens 200, one tool, no tool_choice) — control: the same request with thinking enabled
- **90 `LIVE-free-run-1`** (all rejections or GETs; 5 s pacing) — live/check.ts free-mode verification run (11 checks: listing, retrieve drift, cap sweep, unknown model, temperature, image floor, garbage key through the production wrapper, in-band remediation x2, origin guard)
- **91 `LIVE-billed-run-1`** (6 accepted calls, max_tokens 4-200) — first --billed harness run: found three harness defects (tools in options not transcript, OpenAI-shaped image part instead of pi's {type:image}, cost formula double-subtracting the cache) and one real usage-semantics fact (pi's usage.input is net of cacheRead)
- **92 `LIVE2-liveness`** (maxTokens 8) — live/check.ts --billed run 2, check 'liveness' (through the shipped wrapped adapter)
- **93 `LIVE2-thinking-off`** (maxTokens 8) — live/check.ts --billed run 2, check 'thinking-off' (through the shipped wrapped adapter)
- **94 `LIVE2-thinking-on`** (maxTokens 64) — live/check.ts --billed run 2, check 'thinking-on' (through the shipped wrapped adapter)
- **95 `LIVE2-tool-roundtrip`** (maxTokens 200) — live/check.ts --billed run 2, check 'tool-roundtrip' (through the shipped wrapped adapter)
- **96 `LIVE2-image-colour`** (maxTokens 64) — live/check.ts --billed run 2, check 'image-colour' (through the shipped wrapped adapter)
- **97 `LIVE2-cache-warm`** (maxTokens 4) — live/check.ts --billed run 2, check 'cache-warm' (through the shipped wrapped adapter)
- **98 `LIVE2-cache-hit`** (maxTokens 4) — live/check.ts --billed run 2, check 'cache-hit' (through the shipped wrapped adapter)
- **99 `A1-cache-chat-call1`** (max_tokens 16, unique prefix, 10 s pacing) — implicit prefix cache, identical call 1/4 on a unique ~1K prefix
- **100 `A1-cache-chat-call2`** (max_tokens 16, unique prefix, 10 s pacing) — implicit prefix cache, identical call 2/4 on a unique ~1K prefix
- **101 `A1-cache-chat-call3`** (max_tokens 16, unique prefix, 10 s pacing) — implicit prefix cache, identical call 3/4 on a unique ~1K prefix
- **102 `A1-cache-chat-call4`** (max_tokens 16, unique prefix, 10 s pacing) — implicit prefix cache, identical call 4/4 on a unique ~1K prefix
- **103 `A2-minprefix-6x-call1`** (max_tokens 16, unique prefix per size) — cache bracket: 6 repeats, call 1/2
- **104 `A2-minprefix-6x-call2`** (max_tokens 16, unique prefix per size) — cache bracket: 6 repeats, call 2/2
- **105 `A2-minprefix-12x-call1`** (max_tokens 16, unique prefix per size) — cache bracket: 12 repeats, call 1/2
- **106 `A2-minprefix-12x-call2`** (max_tokens 16, unique prefix per size) — cache bracket: 12 repeats, call 2/2
- **107 `A2-minprefix-24x-call1`** (max_tokens 16, unique prefix per size) — cache bracket: 24 repeats, call 1/2
- **108 `B-tools-2.0-enabled-1of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.0 with thinking enabled, trial 1/5 (tool_choice left at the default so willingness is what is measured)
- **108 `A2-minprefix-24x-call2`** (max_tokens 16, unique prefix per size) — cache bracket: 24 repeats, call 2/2
- **109 `B-tools-2.0-enabled-2of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.0 with thinking enabled, trial 2/5 (tool_choice left at the default so willingness is what is measured)
- **109 `A2-minprefix-48x-call1`** (max_tokens 16, unique prefix per size) — cache bracket: 48 repeats, call 1/2
- **110 `B-tools-2.0-enabled-3of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.0 with thinking enabled, trial 3/5 (tool_choice left at the default so willingness is what is measured)
- **110 `A2-minprefix-48x-call2`** (max_tokens 16, unique prefix per size) — cache bracket: 48 repeats, call 2/2
- **111 `B-tools-2.0-enabled-4of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.0 with thinking enabled, trial 4/5 (tool_choice left at the default so willingness is what is measured)
- **111 `A3-ttl-gap0`** (max_tokens 16, one unique prefix for the whole cell) — cache persistence after a 0 (warm)-minute gap
- **112 `B-tools-2.0-enabled-5of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.0 with thinking enabled, trial 5/5 (tool_choice left at the default so willingness is what is measured)
- **113 `B-tools-2.0-disabled-1of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.0 with thinking disabled, trial 1/5 (tool_choice left at the default so willingness is what is measured)
- **114 `B-tools-2.0-disabled-2of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.0 with thinking disabled, trial 2/5 (tool_choice left at the default so willingness is what is measured)
- **115 `B-tools-2.0-disabled-3of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.0 with thinking disabled, trial 3/5 (tool_choice left at the default so willingness is what is measured)
- **116 `B-tools-2.0-disabled-4of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.0 with thinking disabled, trial 4/5 (tool_choice left at the default so willingness is what is measured)
- **112 `A3-ttl-gap1min`** (max_tokens 16, one unique prefix for the whole cell) — cache persistence after a 1-minute gap
- **117 `B-tools-2.0-disabled-5of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.0 with thinking disabled, trial 5/5 (tool_choice left at the default so willingness is what is measured)
- **118 `B-tools-2.5-enabled-1of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.5-Preview with thinking enabled, trial 1/5 (tool_choice left at the default so willingness is what is measured)
- **119 `B-tools-2.5-enabled-2of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.5-Preview with thinking enabled, trial 2/5 (tool_choice left at the default so willingness is what is measured)
- **120 `B-tools-2.5-enabled-3of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.5-Preview with thinking enabled, trial 3/5 (tool_choice left at the default so willingness is what is measured)
- **121 `B-tools-2.5-enabled-4of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.5-Preview with thinking enabled, trial 4/5 (tool_choice left at the default so willingness is what is measured)
- **122 `B-tools-2.5-enabled-5of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.5-Preview with thinking enabled, trial 5/5 (tool_choice left at the default so willingness is what is measured)
- **123 `B-tools-2.5-disabled-1of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.5-Preview with thinking disabled, trial 1/5 (tool_choice left at the default so willingness is what is measured)
- **124 `B-tools-2.5-disabled-2of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.5-Preview with thinking disabled, trial 2/5 (tool_choice left at the default so willingness is what is measured)
- **125 `B-tools-2.5-disabled-3of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.5-Preview with thinking disabled, trial 3/5 (tool_choice left at the default so willingness is what is measured)
- **126 `B-tools-2.5-disabled-4of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.5-Preview with thinking disabled, trial 4/5 (tool_choice left at the default so willingness is what is measured)
- **127 `C1-constraints-2.5-trial1`** (max_tokens 2048, thinking enabled) — ten sentences ending 一…十 in order: mechanical compliance score, trial 1/3
- **127 `B-tools-2.5-disabled-5of5`** (max_tokens 256, one tool, no forced tool_choice) — tool-call reliability: LongCat-2.5-Preview with thinking disabled, trial 5/5 (tool_choice left at the default so willingness is what is measured)
- **128 `C1-constraints-2.5-trial2`** (max_tokens 2048, thinking enabled) — ten sentences ending 一…十 in order: mechanical compliance score, trial 2/3
- **129 `C1-constraints-2.5-trial3`** (max_tokens 2048, thinking enabled) — ten sentences ending 一…十 in order: mechanical compliance score, trial 3/3
- **113 `A3-ttl-gap5min`** (max_tokens 16, one unique prefix for the whole cell) — cache persistence after a 5-minute gap
- **130 `C1-constraints-2.0-trial1`** (max_tokens 2048, thinking enabled) — ten sentences ending 一…十 in order: mechanical compliance score, trial 1/1
- **131 `C2-language-1of5`** (max_tokens 300, thinking disabled) — English prompt → answer language (CJK ratio): "Explain in two sentences what a mutex is…"
- **132 `C2-language-2of5`** (max_tokens 300, thinking disabled) — English prompt → answer language (CJK ratio): "List three ways to reduce latency in a R…"
- **133 `C2-language-3of5`** (max_tokens 300, thinking disabled) — English prompt → answer language (CJK ratio): "What does the acronym TTL usually mean i…"
- **134 `C2-language-4of5`** (max_tokens 300, thinking disabled) — English prompt → answer language (CJK ratio): "Write one sentence describing what git r…"
- **135 `C2-language-5of5`** (max_tokens 300, thinking disabled) — English prompt → answer language (CJK ratio): "Name two differences between TCP and UDP…"
- **136 `C7-effort-none-baseline`** (max_tokens 256) — 2.5-Preview: is none-baseline accepted, and is it HONOURED (reasoning_tokens)?
- **137 `C7-effort-reasoning_effort-low`** (max_tokens 256) — 2.5-Preview: is reasoning_effort-low accepted, and is it HONOURED (reasoning_tokens)?
- **138 `C7-effort-reasoning_effort-high`** (max_tokens 256) — 2.5-Preview: is reasoning_effort-high accepted, and is it HONOURED (reasoning_tokens)?
- **139 `C7-effort-thinking-budget_tokens-32`** (max_tokens 256) — 2.5-Preview: is thinking-budget_tokens-32 accepted, and is it HONOURED (reasoning_tokens)?
- **140 `B-realpi-generation-2.0`** (pi -p --no-session --thinking low, 600 s timeout, isolated HOME) — real-pi successful generation on LongCat-2.0
- **141 `B-realpi-generation-2.5`** (pi -p --no-session --thinking low, 600 s timeout, isolated HOME) — real-pi successful generation on LongCat-2.5-Preview
- **142 `B-realpi-toolloop-2.0`** (pi -p --no-session --thinking low, 600 s timeout, isolated HOME) — real-pi multi-turn tool loop (read -> write -> reply) on LongCat-2.0 with thinking ON: exercises tool-result and reasoning replay across turns
- **140 `C3-microcoding-2.5`** (max_tokens 4096, thinking enabled) — parseDuration module + tests, then executed locally: LongCat-2.5-Preview
- **143 `B-realpi-toolloop-2.5`** (pi -p --no-session --thinking low, 600 s timeout, isolated HOME) — real-pi multi-turn tool loop (read -> write -> reply) on LongCat-2.5-Preview with thinking ON: exercises tool-result and reasoning replay across turns
- **141 `C3-microcoding-2.0`** (max_tokens 4096, thinking enabled) — parseDuration module + tests, then executed locally: LongCat-2.0
- **142 `C4-oneshot-2.5`** (max_tokens 600, thinking enabled) — one-shot harness-dependence task, LongCat-2.5-Preview: exact-match scoring
- **143 `C4-oneshot-2.0`** (max_tokens 600, thinking enabled) — one-shot harness-dependence task, LongCat-2.0: exact-match scoring
- **144 `C6-needle-middle`** (max_tokens 64, thinking disabled, one call per position) — ~50K-token context with a unique needle at 50% depth: retrieved exactly?
- **145 `C6-needle-end`** (max_tokens 64, thinking disabled, one call per position) — ~50K-token context with a unique needle at 98% depth: retrieved exactly?
- **146 `C1b-constraints-2.0-8k`** (max_tokens 8192, thinking enabled) — re-run of C1 on LongCat-2.0 with an adequate output cap (round 1 was truncated by reasoning at 2048)
- **147 `C3b-microcoding-2.5-16k`** (max_tokens 16384) — micro-coding re-run: LongCat-2.5-Preview, thinking enabled, max_tokens 16384
- **148 `C3b-microcoding-2.0-16k`** (max_tokens 16384) — micro-coding re-run: LongCat-2.0, thinking enabled, max_tokens 16384
- **149 `C3c-microcoding-2.5-off-4k`** (max_tokens 4096) — micro-coding re-run: LongCat-2.5-Preview, thinking disabled, max_tokens 4096
- **114 `A3-ttl-gap15min`** (max_tokens 16, one unique prefix for the whole cell) — cache persistence after a 15-minute gap
- **115 `A4-prompt-cache-key-alpha`** (max_tokens 16, one unique prefix, three key values) — does prompt_cache_key="alpha-session" partition the implicit cache? (call alpha)
- **116 `A4-prompt-cache-key-alpha-again`** (max_tokens 16, one unique prefix, three key values) — does prompt_cache_key="alpha-session" partition the implicit cache? (call alpha-again)
- **117 `A4-prompt-cache-key-beta`** (max_tokens 16, one unique prefix, three key values) — does prompt_cache_key="beta-session" partition the implicit cache? (call beta)
- **118 `A5-accounting-cold`** (max_tokens 16, unique prefix) — cold call: does it report cache_write_tokens, and at what implied price?
- **119 `A5-accounting-warm`** (max_tokens 16, same unique prefix) — warm call: cached_tokens and the resulting cost delta
- **120 `A6-responses-cache-call1`** (max_output_tokens 16, reasoning effort none) — Responses surface cache readout, call 1/2 on a unique ~1K prefix
- **121 `A6-responses-cache-call2`** (max_output_tokens 16, reasoning effort none) — Responses surface cache readout, call 2/2 on a unique ~1K prefix
- **122 `A7-cache-thinking-call1`** (max_tokens 64, thinking enabled) — thinking ON with a repeated unique prefix, call 1/2: is reasoning served from cache or regenerated?
- **123 `A7-cache-thinking-call2`** (max_tokens 64, thinking enabled) — thinking ON with a repeated unique prefix, call 2/2: is reasoning served from cache or regenerated?
- **124 `A8-cross-on-2.0`** (max_tokens 16) — warm a unique prefix on LongCat-2.0 (control for the cross-model test)
- **125 `A9-cross-on-2.5`** (max_tokens 16) — same unique prefix on LongCat-2.5-Preview: does one model's cache serve the other?
- **126 `A8-2.5-cache-call1`** (max_tokens 16) — 2.5-Preview implicit cache, call 1/2 on its own unique prefix
- **127 `A8-2.5-cache-call2`** (max_tokens 16) — 2.5-Preview implicit cache, call 2/2 (same unique prefix)
- **150 `C3d-microcoding-2.5-16k-600s`** (max_tokens 16384, thinking enabled, 600 s timeout) — micro-coding re-run on LongCat-2.5-Preview with a 600 s wall clock (round 2 was cut off at 120 s mid-generation)
- **151 `B1-cross-2.0-cold`** (max_tokens 16, unique prefix per cell) — cross-model cell, control step 1: 2.0 cold
- **152 `B1-cross-2.0-warm`** (max_tokens 16, unique prefix per cell) — cross-model cell, control step 2: 2.0 warm — MUST hit or the cell is void
- **153 `B1-cross-2.5-sameprefix`** (max_tokens 16, unique prefix per cell) — cross-model cell, step 3: the same prefix on 2.5-Preview
- **154 `B2-subblock-r1-call1`** (max_tokens 16, unique prefix per cell) — minimum cacheable prefix: 1 repeat(s), call 1/2
- **155 `B2-subblock-r1-call2`** (max_tokens 16, unique prefix per cell) — minimum cacheable prefix: 1 repeat(s), call 2/2
- **156 `B2-subblock-r2-call1`** (max_tokens 16, unique prefix per cell) — minimum cacheable prefix: 2 repeat(s), call 1/2
- **157 `B2-subblock-r2-call2`** (max_tokens 16, unique prefix per cell) — minimum cacheable prefix: 2 repeat(s), call 2/2
- **158 `B3-tail-call1`** (max_tokens 16, unique prefix per cell) — changed-tail cell: warm the prefix with question 1
- **159 `B3-tail-call2-same`** (max_tokens 16, unique prefix per cell) — changed-tail cell: identical request (control, must hit)
- **160 `B3-tail-call3-changed`** (max_tokens 16, unique prefix per cell) — changed-tail cell: SAME prefix, DIFFERENT final user message — does the prefix still hit?
- **161 `B4-key-call1`** (max_tokens 16, unique prefix per cell) — cross-key cell: warm with the primary key
- **162 `B4-key-call2-samekey`** (max_tokens 16, unique prefix per cell) — cross-key cell: confirm the prefix is warm for the primary key
- **163 `B4-key-call3-KEY5`** (max_tokens 16, unique prefix per cell) — cross-key cell: the same warm prefix sent with KEY5
- **164 `D1-keyed-alpha-Q1`** (max_tokens 16, one unique prefix for the whole cell, 10 s pacing) — cold (first touch of a unique prefix)
- **165 `D2-keyed-alpha-Q1-repeat`** (max_tokens 16, one unique prefix for the whole cell, 10 s pacing) — hit (identical repeat — the control; if this misses, the cell is void)
- **166 `D3-keyed-alpha-Q2-changedtail`** (max_tokens 16, one unique prefix for the whole cell, 10 s pacing) — DISCRIMINATOR: hit ⇒ prefix-based + routing (b); miss ⇒ whole-request keying (a)
- **167 `D4-nokey-Q1`** (max_tokens 16, one unique prefix for the whole cell, 10 s pacing) — hit ⇒ the key is not needed for affinity; miss ⇒ the key is what routes
- **168 `D5-keyed-beta-Q1`** (max_tokens 16, one unique prefix for the whole cell, 10 s pacing) — hit ⇒ the key does not partition; miss ⇒ it does (re-test of A4)
- **0 `live/listing`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.5-Preview`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.0`** (cap asked: -) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.5-Preview`** (cap asked: 262145) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.0`** (cap asked: 131073) — live/check.ts --billed run
- **0 `live/unknown-model`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/temperature-range`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/image-floor`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/garbage-key`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/inband-retrieve`** (cap asked: -) — live/check.ts --billed run
- **0 `live/inband-responses`** (cap asked: -5) — live/check.ts --billed run
- **0 `live/overflow-probe (not run)`** (cap asked: -) — live/check.ts --billed run
- **0 `live/liveness`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-off`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-on`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/tool-roundtrip`** (cap asked: 200) — live/check.ts --billed run
- **0 `live/image-colour`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/cache-key-warm`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-changed-tail`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-control-unkeyed`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-warm`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/cache-hit`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/listing`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.5-Preview`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.0`** (cap asked: -) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.5-Preview`** (cap asked: 262145) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.0`** (cap asked: 131073) — live/check.ts --billed run
- **0 `live/unknown-model`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/temperature-range`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/image-floor`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/garbage-key`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/inband-retrieve`** (cap asked: -) — live/check.ts --billed run
- **0 `live/inband-responses`** (cap asked: -5) — live/check.ts --billed run
- **0 `live/overflow-probe (not run)`** (cap asked: -) — live/check.ts --billed run
- **0 `live/liveness`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-off`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-on`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/tool-roundtrip`** (cap asked: 200) — live/check.ts --billed run
- **0 `live/image-colour`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/cache-key-warm`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-changed-tail`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-control-unkeyed`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-warm`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/cache-hit`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/responses-off`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/responses-on`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/listing`** (cap asked: -) — live/check.ts free run
- **0 `live/retrieve/LongCat-2.5-Preview`** (cap asked: -) — live/check.ts free run
- **0 `live/retrieve/LongCat-2.0`** (cap asked: -) — live/check.ts free run
- **0 `live/cap-sweep/LongCat-2.5-Preview`** (cap asked: 262145) — live/check.ts free run
- **0 `live/cap-sweep/LongCat-2.0`** (cap asked: 131073) — live/check.ts free run
- **0 `live/unknown-model`** (cap asked: 4) — live/check.ts free run
- **0 `live/temperature-range`** (cap asked: 4) — live/check.ts free run
- **0 `live/image-floor`** (cap asked: 4) — live/check.ts free run
- **0 `live/garbage-key`** (cap asked: 8) — live/check.ts free run
- **0 `live/inband-retrieve`** (cap asked: -) — live/check.ts free run
- **0 `live/inband-responses`** (cap asked: -5) — live/check.ts free run
- **0 `live/overflow-probe (not run)`** (cap asked: -) — live/check.ts free run
- **169 `DD-A1-listing`** (no inference) — drift: does the listing still hold exactly 2.5-Preview + 2.0
- **170 `DD-A2-detail-2.5`** (no inference) — drift: window/modality/pricing/supported_parameters for LongCat-2.5-Preview
- **171 `DD-A3-detail-2.0`** (no inference) — drift: window/modality/pricing/supported_parameters for LongCat-2.0
- **172 `DD-A4-topp-2`** (max_tokens 4 (rejection expected)) — top_p range (0,1] validated? (new model-params page)
- **173 `DD-A5-topk-101`** (max_tokens 4 (rejection expected)) — top_k range [-1,100] validated? (new model-params page)
- **174 `DD-A6-reppen-1.6`** (max_tokens 4 (rejection expected)) — repetition_penalty range [1,1.5] validated? (new model-params page)
- **175 `DD-A7-multi-violation`** (max_tokens 4 (rejection expected)) — does the 400 name EVERY violating parameter (docs now claim so) or only the first (measured 2026-10-10)?
- **176 `DD-A8-budget-over`** (max_tokens 4 (rejection expected)) — is the NEW thinking_budget range-checked to <=262144?
- **177 `DD-A9-temp-1.5`** (max_tokens - (rejection expected)) — temperature drift re-check: 400 (2026-10-10) vs accepted+overridden (docs 2026-10-24)
- **178 `DD-A9-temp-1.5`** (max_tokens 4 (rejection expected)) — temperature drift re-check: 400 (2026-10-10) vs accepted+overridden (docs 2026-10-24)
- **179 `DD-B1-budget32`** (max_tokens 200, arithmetic prompt, 120 s timeout) — does top-level thinking_budget=32 bound reasoning_tokens?
- **180 `DD-B2-nobudget`** (max_tokens 200, arithmetic prompt, 120 s timeout) — control: same prompt, no budget — how many reasoning tokens does it want?
- **181 `DD-B3-budget256`** (max_tokens 400, arithmetic prompt, 120 s timeout) — does a LARGER budget move the ceiling (32 vs 256 vs none)?
- **182 `DD-B4-off-budget32`** (max_tokens 64, arithmetic prompt, 120 s timeout) — conflict cell: disabled + budget → disabled must win (no reasoning)
- **183 `DD-B5-effort-none`** (max_output_tokens 512, arithmetic prompt, 120 s timeout) — Responses effort scale: does effort=none move reasoning_tokens?
- **184 `DD-B5-effort-minimal`** (max_output_tokens 512, arithmetic prompt, 120 s timeout) — Responses effort scale: does effort=minimal move reasoning_tokens?
- **185 `DD-B5-effort-low`** (max_output_tokens 512, arithmetic prompt, 120 s timeout) — Responses effort scale: does effort=low move reasoning_tokens?
- **186 `DD-B5-effort-medium`** (max_output_tokens 512, arithmetic prompt, 120 s timeout) — Responses effort scale: does effort=medium move reasoning_tokens? (also summary:auto — does a summary arrive?)
- **187 `DD-B5-effort-high`** (max_output_tokens 512, arithmetic prompt, 120 s timeout) — Responses effort scale: does effort=high move reasoning_tokens?
- **188 `DD-B5-effort-xhigh`** (max_output_tokens 512, arithmetic prompt, 120 s timeout) — Responses effort scale: does effort=xhigh move reasoning_tokens?
- **189 `DD-B6-effort20-none`** (max_output_tokens 512, arithmetic prompt, 120 s timeout) — control: effort=none on LongCat-2.0 — does the 2026-10-11 'none zeroes reasoning' finding still hold?
- **190 `DD-B6-effort20-low`** (max_output_tokens 512, arithmetic prompt, 120 s timeout) — control: effort=low on LongCat-2.0 — does the 2026-10-11 'none zeroes reasoning' finding still hold?
- **191 `DD-B7-resp25-thinking-disabled`** (max_output_tokens 512, arithmetic prompt, 120 s timeout) — Responses surface on 2.5-Preview: is there ANY switch that zeroes reasoning (effort:none is ignored)?
- **192 `DD-B8-resp25-effortnone-thinking-disabled`** (max_output_tokens 512, arithmetic prompt, 120 s timeout) — Responses surface on 2.5-Preview: is there ANY switch that zeroes reasoning (effort:none is ignored)?
- **193 `DD-C1-c3-budgeted`** (max_tokens 6144, 480 s timeout) — C3 microcoding on 2.5-Preview WITH thinking_budget 1024: does the budget bind and does the code still pass?
- **194 `DD-C1-score`** (local node --test) — mechanical score of DD-C1-c3-budgeted (no API call)
- **195 `DD-C2-c3-thinking-off`** (max_tokens 4096, 240 s timeout) — C3 microcoding on 2.5-Preview with thinking DISABLED under the new forced-0.7 policy: does the 8/9 C3c precedent still hold?
- **196 `DD-C2-score`** (local node --test) — mechanical score of DD-C2-c3-thinking-off (no API call)
- **197 `live-temperature-drift-run1`** (max_tokens 4) — live/check.ts free run: the temperature-range probe (temperature 1.5, max_tokens 4) was ACCEPTED — drift from the measured 400 of 2026-10-10; recorded here because LONGCAT_LIVE_LEDGER was not set
- **198 `live-temperature-drift-run2`** (max_tokens 4) — live/check.ts free run: the temperature-range probe (temperature 1.5, max_tokens 4) was ACCEPTED — drift from the measured 400 of 2026-10-10; recorded here because LONGCAT_LIVE_LEDGER was not set
- **0 `live/listing`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.5-Preview`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.0`** (cap asked: -) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.5-Preview`** (cap asked: 262145) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.0`** (cap asked: 131073) — live/check.ts --billed run
- **0 `live/unknown-model`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/top-p-range`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/image-floor`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/garbage-key`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/inband-retrieve`** (cap asked: -) — live/check.ts --billed run
- **0 `live/inband-responses`** (cap asked: -5) — live/check.ts --billed run
- **0 `live/overflow-probe (not run)`** (cap asked: -) — live/check.ts --billed run
- **0 `live/liveness`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-off`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-on`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/temperature-override`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/tool-roundtrip`** (cap asked: 200) — live/check.ts --billed run
- **0 `live/image-colour`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/cache-key-warm`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-changed-tail`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-control-unkeyed`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-warm`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/cache-hit`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/listing`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.5-Preview`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.0`** (cap asked: -) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.5-Preview`** (cap asked: 262145) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.0`** (cap asked: 131073) — live/check.ts --billed run
- **0 `live/unknown-model`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/top-p-range`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/image-floor`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/garbage-key`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/inband-retrieve`** (cap asked: -) — live/check.ts --billed run
- **0 `live/inband-responses`** (cap asked: -5) — live/check.ts --billed run
- **0 `live/overflow-probe (not run)`** (cap asked: -) — live/check.ts --billed run
- **0 `live/liveness`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-off`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-on`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/temperature-override`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/tool-roundtrip`** (cap asked: 200) — live/check.ts --billed run
- **0 `live/image-colour`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/cache-key-warm`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-changed-tail`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-control-unkeyed`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-warm`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/cache-hit`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/responses-off`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/responses-on`** (cap asked: 64) — live/check.ts --billed run
- **199 `DD2-M1-turn1`** (maxTokens 300, 120 s wall) — Responses multi-turn, turn 1: does 2.5-Preview emit a function_call item pi parses as toolUse?
- **200 `DD2-M2-turn2`** (maxTokens 400, 120 s wall) — Responses multi-turn, turn 2: assistant replay (incl. reasoning items) + function_call_output backfill — does the gateway accept it and finish?
- **201 `DD2-payload-analysis`** (local analysis of the captured payload) — what turn 2's REQUEST replayed (no API call)
- **202 `DD2-M1-turn1`** (maxTokens 300, 120 s wall) — Responses multi-turn, turn 1: does 2.5-Preview emit a function_call item pi parses as toolUse?
- **203 `DD2-M2-turn2`** (maxTokens 400, 120 s wall) — Responses multi-turn, turn 2: assistant replay (incl. reasoning items) + function_call_output backfill — does the gateway accept it and finish?
- **204 `DD2-payload-analysis`** (local analysis of the captured payload) — what turn 2's REQUEST replayed (no API call)
- **0 `live/listing`** (cap asked: -) — live/check.ts free run
- **0 `live/retrieve/LongCat-2.5-Preview`** (cap asked: -) — live/check.ts free run
- **0 `live/retrieve/LongCat-2.0`** (cap asked: -) — live/check.ts free run
- **0 `live/cap-sweep/LongCat-2.5-Preview`** (cap asked: 262145) — live/check.ts free run
- **0 `live/cap-sweep/LongCat-2.0`** (cap asked: 131073) — live/check.ts free run
- **0 `live/unknown-model`** (cap asked: 4) — live/check.ts free run
- **0 `live/top-p-range`** (cap asked: 4) — live/check.ts free run
- **0 `live/image-floor`** (cap asked: 4) — live/check.ts free run
- **0 `live/garbage-key`** (cap asked: 8) — live/check.ts free run
- **0 `live/inband-retrieve`** (cap asked: -) — live/check.ts free run
- **0 `live/inband-responses`** (cap asked: -5) — live/check.ts free run
- **0 `live/overflow-probe (not run)`** (cap asked: -) — live/check.ts free run
- **0 `live/listing`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.5-Preview`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.0`** (cap asked: -) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.5-Preview`** (cap asked: 262145) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.0`** (cap asked: 131073) — live/check.ts --billed run
- **0 `live/unknown-model`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/top-p-range`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/image-floor`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/garbage-key`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/inband-retrieve`** (cap asked: -) — live/check.ts --billed run
- **0 `live/inband-responses`** (cap asked: -5) — live/check.ts --billed run
- **0 `live/overflow-probe (not run)`** (cap asked: -) — live/check.ts --billed run
- **0 `live/liveness`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-off`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-on`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/temperature-override`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/tool-roundtrip`** (cap asked: 200) — live/check.ts --billed run
- **0 `live/image-colour`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/cache-key-warm`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-changed-tail`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-control-unkeyed`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-warm`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/cache-hit`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/responses-off`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/responses-on`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/listing`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.5-Preview`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.0`** (cap asked: -) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.5-Preview`** (cap asked: 262145) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.0`** (cap asked: 131073) — live/check.ts --billed run
- **0 `live/unknown-model`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/top-p-range`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/image-floor`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/garbage-key`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/inband-retrieve`** (cap asked: -) — live/check.ts --billed run
- **0 `live/inband-responses`** (cap asked: -5) — live/check.ts --billed run
- **0 `live/overflow-probe (not run)`** (cap asked: -) — live/check.ts --billed run
- **0 `live/liveness`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-off`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-on`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/temperature-override`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/tool-roundtrip`** (cap asked: 200) — live/check.ts --billed run
- **0 `live/image-colour`** (cap asked: 128) — live/check.ts --billed run
- **0 `live/cache-key-warm`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-changed-tail`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-control-unkeyed`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-warm`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/cache-hit`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/responses-off`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/responses-on`** (cap asked: 64) — live/check.ts --billed run
- **205 `DD3-IR1-responses`** (max_output_tokens 128, 120 s) — image colour stability on Responses (N=3)
- **206 `DD3-IR2-responses`** (max_output_tokens 128, 120 s) — image colour stability on Responses (N=3)
- **207 `DD3-IR3-responses`** (max_output_tokens 128, 120 s) — image colour stability on Responses (N=3)
- **208 `DD3-IR4-chat`** (max_tokens 128, 120 s) — image colour stability on chat, control (N=2)
- **209 `DD3-IR5-chat`** (max_tokens 128, 120 s) — image colour stability on chat, control (N=2)
- **0 `live/listing`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.5-Preview`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.0`** (cap asked: -) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.5-Preview`** (cap asked: 262145) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.0`** (cap asked: 131073) — live/check.ts --billed run
- **0 `live/unknown-model`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/top-p-range`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/image-floor`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/garbage-key`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/inband-retrieve`** (cap asked: -) — live/check.ts --billed run
- **0 `live/inband-responses`** (cap asked: -5) — live/check.ts --billed run
- **0 `live/overflow-probe (not run)`** (cap asked: -) — live/check.ts --billed run
- **0 `live/liveness`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-off`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-on`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/temperature-override`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/tool-roundtrip`** (cap asked: 200) — live/check.ts --billed run
- **0 `live/cache-key-warm`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-changed-tail`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-control-unkeyed`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-warm`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/cache-hit`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/responses-off`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/responses-on`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/listing`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.5-Preview`** (cap asked: -) — live/check.ts --billed run
- **0 `live/retrieve/LongCat-2.0`** (cap asked: -) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.5-Preview`** (cap asked: 262145) — live/check.ts --billed run
- **0 `live/cap-sweep/LongCat-2.0`** (cap asked: 131073) — live/check.ts --billed run
- **0 `live/unknown-model`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/top-p-range`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/image-floor`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/garbage-key`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/inband-retrieve`** (cap asked: -) — live/check.ts --billed run
- **0 `live/inband-responses`** (cap asked: -5) — live/check.ts --billed run
- **0 `live/overflow-probe (not run)`** (cap asked: -) — live/check.ts --billed run
- **0 `live/liveness`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-off`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/thinking-on`** (cap asked: 64) — live/check.ts --billed run
- **0 `live/temperature-override`** (cap asked: 8) — live/check.ts --billed run
- **0 `live/tool-roundtrip`** (cap asked: 200) — live/check.ts --billed run
- **0 `live/image-colour`** (cap asked: 128) — live/check.ts --billed run
- **0 `live/cache-key-warm`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-changed-tail`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-key-control-unkeyed`** (cap asked: 16) — live/check.ts --billed run
- **0 `live/cache-warm`** (cap asked: 4) — live/check.ts --billed run
- **0 `live/cache-hit`** (cap asked: 4) — live/check.ts --billed run
