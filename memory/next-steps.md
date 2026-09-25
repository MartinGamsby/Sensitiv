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
   93s, enrich 65s). Measure the extraction cache hit rate on a repeat run and a quick run's
   end-to-end cost first. The baseline predates parallel searches, a single extraction
   pass, best-case enrichment skips and poll-based scroll, so re-measure before
   anything else. Then: tune `MAX_ENRICH_PLACES`; consider not asking the model for
   `url`/`lat`/`lng` on search cards (parsed deterministically anyway, and costs output
   tokens). Job-level reuse is mostly covered by the extraction cache.
   Prompt caching: revisit only if the system prompt exceeds ~1100 tokens.
5. **Housing adapters** `kijiji`, `craigslist` behind the `mold` chip.
6. **Deploy hardening** before any shared deployment: server-only keys, encrypted
   `user_secrets`, real auth replacing `getOrCreateLocalUser()`; revisit `extraction_cache`
   scoping.

Not planned: auto-contacting places, payments, marketplace, diagnosis, booking, hosting
others' keys, claiming a kitchen is safe.
