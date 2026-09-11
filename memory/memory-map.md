# Memory map

Index of the `memory/` store. Read this first every session.

| File | Holds | Update when |
|---|---|---|
| `memory-map.md` | This index. | You add or repurpose a memory file. |
| `summary.md` | Current project state — what exists, what is deferred, where the seams are. | A package/route/module lands or is removed, or a deferral is resolved. |
| `terminology.md` | Domain vocabulary — the words the spec uses (intent, requirement, adapter, planner, dossier, evidence polarity, replay, BYOK, partial, search language vs UI locale, budget, canonical key). | A domain term is introduced, renamed, or its meaning shifts. |
| `architecture.md` | How the pieces fit: package boundaries, the request/job flow, the agent loop, and the seams that make it testable. | A boundary moves, a seam changes shape, or a new module joins the flow. |
| `catalog-contract.md` | The rules for `packages/shared/catalog/` — the source of truth for intents and requirements, and what "fail closed" means. | An intent/requirement/adapter id or a lookup helper changes. |
| `security-invariants.md` | The non-negotiables: secret handling, SSRF, prompt injection, ownership scoping — each with the test that guards it. | An invariant is added, or its guarding test moves. |
| `running-and-testing.md` | How to install, migrate, seed, run and test; what the acceptance gates are and which tests prove them. | A script, gate, or test-layout convention changes. |
| `next-steps.md` | Priority-ordered roadmap after the v1 scaffold — one PR per item, starting with making a real (non-fixture) search work. | An item lands, is dropped, or the ordering changes. |

Keep entries short and factual. Memory is for orientation, not documentation — the code and
`CLAUDE.md` are authoritative for how things work.
