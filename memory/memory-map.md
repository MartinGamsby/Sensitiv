# Memory map

Read first. Memory is orientation, not a changelog — code and `CLAUDE.md` are authoritative.
Keep entries terse; state the rule and the one-line why, not the history.

| File | Holds |
|---|---|
| `summary.md` | What exists, current state, known gaps. |
| `terminology.md` | Domain vocabulary. |
| `architecture.md` | Boundaries, job flow, agent loop, scoring pipeline, seams. |
| `catalog-contract.md` | Catalog rules, weights, how a claim becomes a score. |
| `security-invariants.md` | Non-negotiables, each with its guarding test. |
| `running-and-testing.md` | Commands, test conventions, acceptance gates. |
| `next-steps.md` | Open roadmap items only. |

Update the file a change makes stale, in the same change.
