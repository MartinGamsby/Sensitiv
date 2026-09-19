import { z } from "zod";
import { DEFAULT_REQUIREMENT_WEIGHT } from "../../catalog/requirements.ts";

// A requirement the planner decided to research. `id` and `intentIds` are PLAIN
// STRINGS on purpose — they are validated against the config-driven catalog at
// runtime (Section 3), never modelled as a TS union. This is the single most
// important constraint in the codebase: business logic must look ids up, not
// switch on them.
export const PlannedRequirementSchema = z.object({
  id: z.string().min(1), // catalog id OR "custom_<slug>"
  catalogId: z.string().min(1).optional(), // set when derived from the catalog
  label: z.string().min(1), // display text in the UI locale
  intentIds: z.array(z.string().min(1)), // MUST be valid catalog intent ids
  must: z.array(z.string()),
  nice: z.array(z.string()),
  allergens: z.array(z.string()).optional(),
  diet: z.string().optional(),
  /** Scoring multiplier, carried from the catalog (see `CatalogRequirement.weight`).
   *  Defaults to the ad-hoc tier so a `custom_<slug>` requirement the planner
   *  invented never outranks a chip the user deliberately picked. */
  weight: z.number().positive().default(DEFAULT_REQUIREMENT_WEIGHT),
  /** Catalog `satisfiedByHints`, carried through to the extraction prompt so
   *  the model stops marking an all-gluten-free venue `unclear` for lacking a
   *  "dedicated gluten-free kitchen". */
  satisfiedBy: z.array(z.string()).default([]),
  /**
   * `"subject"` when this requirement is WHAT KIND OF PLACE the user asked for
   * ("Mexican restaurant", "bakery", "two-bedroom apartment") rather than a
   * property it should have ("open late", "has a patio").
   *
   * The distinction is a scoring one, and it exists because of a real run: a
   * celiac + "Mexican restaurant" search ranked `Cookie Stéfanie`, a pastry
   * shop, FIRST. Its celiac evidence was excellent (+5.85) and "is it Mexican"
   * came back `unverified`, which scores 0 — so being the wrong kind of place
   * entirely was free, while an actual gluten-free Mexican restaurant came
   * second. A subject is not a preference the score may trade away; it is the
   * question. See `scorePlace`, which weights it accordingly and makes an
   * unsettled subject cost something.
   *
   * Optional, and absent reads as `"preference"` everywhere. That is what makes
   * it safe on a job row written before this field existed: an older dossier
   * re-scores exactly as it did, rather than having every requirement suddenly
   * treated as the subject of its search.
   */
  kind: z.enum(["subject", "preference"]).optional(),
  /**
   * Category terms that tell a place of THIS kind from one of another, for a
   * `kind: "subject"` requirement. The planner writes them once per run; scoring
   * then reads a place's own `category` against them with no LLM call at all.
   *
   * Three grades, because "is this a Mexican restaurant" is not a yes/no
   * question about `chocolate;crepe;dessert` and `arepa;venezuelan`:
   *
   *   - `strong`   — this IS the kind of place asked for ("mexican", "taqueria");
   *   - `related`  — adjacent, and not what was asked for ("venezuelan", "latin
   *                  american", "tex-mex");
   *   - `excluded` — a different kind of place ("dessert", "bakery", "cafe").
   *
   * Terms are matched as whole token runs against the category, case- and
   * accent-insensitively, so `bar` never matches inside `barbecue`.
   *
   * Absent everywhere except a subject, and optional even there: scoring falls
   * back to the requirement's own label, which still settles the common case of
   * a category that says "Mexican restaurant" in as many words.
   */
  categoryHints: z
    .object({
      strong: z.array(z.string()).default([]),
      related: z.array(z.string()).default([]),
      excluded: z.array(z.string()).default([]),
    })
    .optional(),
});

export type PlannedRequirement = z.infer<typeof PlannedRequirementSchema>;
