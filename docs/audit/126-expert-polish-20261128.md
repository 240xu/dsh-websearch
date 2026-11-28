# 126 — 2026-11-28 expert polish round (2.9.0)

Baseline: `c6fb47d` / 2.8.9 (211 tests). This round ran six independent
read-only audits against that commit, then integrated the highest-evidence
findings. Verification after integration: **213/213** unit tests, health 1/1,
both runtime patches reconstruct byte-identically, npm 2.9.0 published.

## Experts and their strongest findings

| Expert | Scope | P1 / decisive finding | Disposition |
| --- | --- | --- | --- |
| `bug-deepdive` | boundary/state/backends/trust | 10 MiB response cap held only on the proxied path; native fetch accepted 20 MiB in a local repro | fixed: `cappedNativeFetch` |
| `logic-polish` | search path/perf/state | a backend that ignores its signal outlived `backendTimeoutMs`; multi-query multiplied the tail (3 × 30 s) | fixed: guard race + search-wide budget |
| `semantics-audit` | error taxonomy/contracts/docs | four backends reported missing keys as `WEB_PROVIDER_UNAVAILABLE`; `official` appended a cache note to `content`; `truncated` used the user bound | fixed |
| `frontend-ux` | settings card | EN render contained 8 CJK backend labels; 20 controls had no accessible name; toggle errors far from the control | fixed (subset, below) |
| `shadow-audit` | depth/contrast/states | one border weight for every level, 18 hardcoded hex uses, ghost-button hover measured 2.06:1 light / 1.11:1 dark | fixed: token depth scale |
| `authority-research` | primary sources | cross-backend concatenation starves later engines; Firecrawl 8 is below its documented limit; citation/URL hygiene missing | fixed round-robin, Firecrawl limit, URL key, fence; citation checks deferred |

## Code fixes (all with regression tests)

- **Egress cap (security).** `lib/util/egress-fetch.js` wraps native responses
  in a byte-counting `TransformStream`, so the 10 MiB ceiling and its error text
  are identical on direct, `NO_PROXY`, forwarder-fallback and tunneled paths.
- **Timeout truth (P1).** `Promise.race` against a guard rejects on the caller
  signal or the backend timer even if `backend.search()` never settles. A
  search-wide deadline (`backendTimeoutMs`) replaces the per-variant full
  timeout, so `multiQueryEnabled` cannot produce N × 30 s. A hung backend now
  fails at ≈120 ms in the new test instead of 1.5 s+.
- **Malformed backend results.** A fulfilled value without `sources[]` is
  converted to `WEB_PROVIDER_ERROR` inside `runBackend`, so telemetry, health
  and the all-failed path agree; `undefined` is no longer a successful 0-hit.
- **Error taxonomy.** Brave/Tavily/Serper/Mojeek use
  `WEB_PROVIDER_CREDENTIAL_MISSING`; the all-failed hint only fires for that
  code. The message says "N of M enabled" and folds attempts to unique ids.
- **`official` content.** The cache-hit note is gated by `resultHeader`, so an
  `official` hit has no provider-added text. `resultHeader` is now a real
  `Config` field and a card select (7 enum selects).
- **`truncated`.** Compared against the seam's `request.maxResults` bound, not
  the user's `numResults`; a preference cut is no longer seam truncation.
- **Fast-fail history.** Keyless/rate-limited early throws record a zero-result
  history entry; cache hits replay the fan-out's `backendsOk/backendsTotal`.
- **Settings CAS.** `expectedRevision` must be an integer or the route returns
  400; a string/float can no longer silently disable the host CAS.
- **Round-robin merge.** `collectFanoutResults` interleaves backend lists by
  rank before dedupe, mirroring `dsh-tool-web`'s `mergeSearchResults`. The old
  concatenation let Exa+Parallel fill a 10-result cap.
- **Provider alignment.** Firecrawl sends `min(maxResults, 100)` instead of 8;
  Exa highlights and Firecrawl descriptions are bounded to 400 chars;
  Brave/Serper only emit ISO-shaped `publishedAt`.
- **URL hygiene.** Dedupe keys drop fragments and `utm_*`/`fbclid`/`gclid`;
  result headers state that titles/snippets are untrusted data.
- **State cleanup.** IPv6 literals are unbracketed for `net`/TLS/Host
  comparison; expired cooldowns are not published; corrupt cache entries and
  failed-rename `.tmp` files are unlinked; duplicate `enabledBackends` are
  deduped; credential events refresh only their ref when one is supplied.
- **UI.** Backend labels move into both dictionaries; every input/select/key
  has an accessible name; the action bar is `role=status`/`aria-live=polite`
  and sticky; toggle failures render at the failing row; key badges show
  "checking" before the first read; the status strip reports an
  `enabledBackends` override instead of the ignored toggles.
- **Depth.** Tokenized state colors (no hex), 4/8/12/20 radii, l3/l4 border
  tiers, 36 px/14 px buttons, one 2 px focus ring, correct ghost hover, and
  disabled/hover states; no new surface shadows.

## Authoritative basis (primary sources used in this round)

- DSH 0.2.2-rc.5 host: `dsh-tool-web/src/search.ts` (`mergeSearchResults`
  rank-major round-robin, 30 s `searchTimeoutMs`), `dsh-web/src/types.ts:26-63`
  (`content`, `truncated` semantics), `dsh-web/src/index.ts:312-335`
  (selection rule + `maxResults`).
- OpenAI web search guide (`search_context_size`, `url_citation`), Anthropic
  `web_search_20250305` (`max_uses`, domain filters), Exa `/search`
  (`numResults` 10/100, highlights), Parallel `/v1/search` (`max_results`,
  2–3 `search_queries`), Firecrawl v2 OpenAPI (`limit` 10/100), Brave
  (`count` 20), Tavily (`max_results` 20), SearXNG (`pageno`, JSON opt-in),
  TinyFish search API quota.
- Liu et al. TACL 2024 (arXiv:2307.03172, DOI 10.1162/tacl_a_00638);
  *Power of Noise* SIGIR 2024 (arXiv:2401.14887); *Found in the Middle*
  (arXiv:2406.16008); *Evaluating Verifiability* (arXiv:2304.09848);
  ALCE (arXiv:2305.14627); *Cited but Not Verified* (arXiv:2605.06635);
  Bruch et al. TOIS 2023 (arXiv:2210.11934); Cormack et al. SIGIR 2009
  (DOI 10.1145/1571941.1572114); *Best Practices in RAG* (arXiv:2407.01219);
  ARAGOG (arXiv:2404.01037); OWASP LLM01:2025; Greshake et al.
  (arXiv:2302.12173); InjecAgent (arXiv:2403.02691).

## Deferred (documented, not silently dropped)

- Batch settings writes (`setMany`) and dropping redundant post-save GETs.
- Deterministic citation verification (cited URL ∈ returned set; snippet
  entailment) and domain allow/block mapping into OpenAI/Anthropic/Exa.
- SearXNG pagination, Exa's 100-result ceiling, Parallel's 2–3 queries,
  cache `no-store`/retention disclosure.
- Multi-query telemetry folded by backend; cache key order sensitivity.
- RRF's 2× original-query weight is a product heuristic, not an empirically
  validated constant; the host uses round-robin for multi-query. Kept because
  the regression test demonstrates the narrow-variant demotion it prevents;
  re-evaluate with end-to-end answer quality, not retrieval-only metrics.
- `balanced` still adds a header + telemetry (documented divergence); only
  `official` is byte-clean for `content`.
