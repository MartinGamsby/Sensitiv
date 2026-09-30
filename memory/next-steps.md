# Next steps

Open items only, in priority order. Remove an item when it lands.

1. **Verify live.** Enrichment, thumbnails, rank-before-cap and the progress model have
   only been tested and hand-probed, not run through Solari. Unhandled: Maps "showing
   results in another city" redirect.
2. **Tune cross-source merge.** `canonicalKey` vs real OSM `addr:*` and Google addresses;
   corroboration is reachable but untuned. OSM `cuisine` matching for custom requirements
   deliberately not built.
3. **Score granularity.** Unused signals: review-topic counts ("mentioned in 89 reviews"),
   source recency, catalog `negativeHints`.
4. **Run cost** (baseline job `906508d9`, 3:01: OSM 8.8s, Maps searches 110s of which LLM
   93s, enrich 65s; last quick run `ad8a5660`, 1:47: extract 33.5s, enrich 58.9s). Since
   then, all untested live: parallel searches, one extraction pass, best-case skips,
   poll-based scroll, the distance cut, URL-free prompts, balanced batches, per-call
   effort, whole-round batches, tabs released during model calls. Re-measure a quick run,
   a deep run and a repeat (cache hit rate) first; each run now logs a `model:` line
   with calls, tokens and thinking tokens. Then: raise `EXTRACTION_CONCURRENCY` (3) once
   the account's limits are known (`anthropic-ratelimit-*` response headers); tune
   `MAX_ENRICH_PLACES`. Prompt caching: revisit only if the system prompt exceeds ~1100
   tokens.
5. **Housing adapters** `kijiji`, `craigslist` behind the `mold` chip.
6. **Deploy hardening** before any shared deployment: server-only keys, encrypted
   `user_secrets`, real auth replacing `getOrCreateLocalUser()`; revisit `extraction_cache`
   scoping.

Not planned: auto-contacting places, payments, marketplace, diagnosis, booking, hosting
others' keys, claiming a kitchen is safe.
