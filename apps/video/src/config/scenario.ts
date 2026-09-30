import { z } from "zod";
import { RunSnapshotSchema } from "./run-snapshot.ts";

// The shape of a demo scenario — everything a video says or shows that is not
// the Sensitiv UI itself. `scenarios/<id>.ts` fills it in; this validates it
// when the file is loaded, so a typo fails loudly in the Studio and in
// `pnpm video` instead of rendering a blank caption.

/**
 * An image: a path under `apps/video/public/` ("brand/logo.png") or an https
 * URL. URLs are fetched once by `pnpm video:assets` and served from the local
 * cache, so the render itself never touches the network.
 */
const ImageRefSchema = z.string().min(1);

const CaptionSchema = z.object({
  /** Small label above the title, e.g. a step number. */
  kicker: z.string().optional(),
  title: z.string().min(1),
  body: z.string().optional(),
});
export type Caption = z.infer<typeof CaptionSchema>;

const PointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** Every beat's length, in seconds. Each has a default; override any subset. */
export const TimingSchema = z.object({
  hook: z.number().positive().default(5.5),
  brand: z.number().positive().default(3.2),
  outro: z.number().positive().default(5),
  /** Cross-fade between the four top-level scenes. */
  transition: z.number().min(0).default(0.6),

  // The walkthrough, beat by beat, in the order they play.
  enter: z.number().positive().default(1.4),
  openMap: z.number().positive().default(1.1),
  findPin: z.number().positive().default(1.7),
  dropPin: z.number().positive().default(1.5),
  radius: z.number().positive().default(2.4),
  toChips: z.number().positive().default(0.9),
  requirement: z.number().positive().default(2.2),
  toRequest: z.number().positive().default(0.8),
  typeRequest: z.number().positive().default(2),
  submit: z.number().positive().default(1.4),
  research: z.number().positive().default(9),
  results: z.number().positive().default(4.5),
  evidence: z.number().positive().default(6),
  mapView: z.number().positive().default(4.5),
  exit: z.number().positive().default(1),
});
export type Timing = z.infer<typeof TimingSchema>;

export const ScenarioSchema = z.object({
  /** Composition id and output file name: letters, digits and dashes. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes"),

  video: z
    .object({
      width: z.number().int().min(640).default(1920),
      height: z.number().int().min(360).default(1080),
      fps: z.number().int().min(15).max(60).default(30),
    })
    .default({}),

  /**
   * The GIF (`pnpm video:gif`), for the README. Rendered from the same
   * composition with a still background and a camera that holds still
   * between moves: a GIF stores unchanged pixels almost for free and pays in
   * full for every one that moves. The defaults come to about 20 MB; lower
   * any of the three to trade quality for size.
   */
  gif: z
    .object({
      width: z.number().int().min(320).default(800),
      fps: z.number().int().min(5).max(30).default(12),
      /** Palette size, 16–256. The UI is mostly flat dark colour. */
      colors: z.number().int().min(16).max(256).default(128),
    })
    .default({}),

  /** The app's own two themes. */
  theme: z.enum(["dark", "light"]).default("dark"),
  /** Language of the recreated UI: its labels come from `apps/web/messages`. */
  locale: z.enum(["en", "fr"]).default("en"),

  brand: z.object({
    name: z.string().min(1).default("Sensitiv"),
    tagline: z.string().min(1),
    /** Replaces the app's pin-and-check mark. */
    logo: ImageRefSchema.optional(),
    /** What the fake browser's address bar shows. */
    address: z.string().default("localhost:3000"),
  }),

  /**
   * What the demo types into the form, field by field. Keep it in step with
   * `run` — the results shown later are that run's, not a re-run of these.
   */
  search: z.object({
    request: z.string(),
    /** Catalog id of the requirement chip to tick: `celiac`, `allergy`, … */
    requirement: z.string().min(1),
    /** Which of the chip's intents stay on. `["dining"]` = restaurants only. */
    intents: z.array(z.string().min(1)).min(1),
    /** Where the pin goes, and the name the video gives that spot. */
    pin: PointSchema.extend({ label: z.string().min(1) }),
    /** What the app names the pin once it has reverse-geocoded it. */
    locationText: z.string().min(1),
    radiusKm: z.number().positive(),
    /** Where the map opens before it is flown to the pin. The app's own
     *  default: central Montreal. */
    mapStart: PointSchema.default({ lat: 45.5233, lng: -73.5858 }),
  }),

  /**
   * Every sentence the video says. Strings may use `{placeholders}`, filled
   * from the run: {places} {evidence} {radius} {pin} {request} {requirement}
   * {location} {sources} {duration}. Wrap words in *asterisks* to colour them.
   */
  copy: z.object({
    hook: z.array(z.string().min(1)).min(1).max(4),
    captions: z.object({
      where: CaptionSchema,
      requirement: CaptionSchema,
      request: CaptionSchema,
      research: CaptionSchema,
      dossier: CaptionSchema,
      evidence: CaptionSchema,
      map: CaptionSchema,
    }),
    outro: z.object({
      headline: z.string().min(1),
      body: z.string().optional(),
      cta: z.string().optional(),
    }),
    /** Labels of the "agent at work" panel; `{n}` is the count. */
    agent: z
      .object({
        working: z.string().default("Researching"),
        complete: z.string().default("Research complete"),
        spedUp: z.string().default("sped up"),
        plan: z.string().default("Plan"),
        sources: z.string().default("Sources"),
        reading: z.string().default("Reading listings & websites"),
        evidence: z.string().default("Evidence found"),
        result: z.string().default("Result"),
        searching: z.string().default("searching"),
        querying: z.string().default("querying"),
        scanned: z.string().default("{n} places scanned"),
        tagged: z.string().default("{n} tagged places"),
        found: z.string().default("+{n} evidence"),
        nothing: z.string().default("nothing on it"),
        placesRanked: z.string().default("places ranked"),
        evidenceItems: z.string().default("evidence items"),
        conflicts: z.string().default("conflicts"),
      })
      .default({}),
  }),

  images: z
    .object({
      /**
       * Per place name, the photo to use instead of the run's own — or `null`
       * for the initials tile. A name not listed keeps the run's photo.
       */
      photos: z.record(ImageRefSchema.nullable()).default({}),
      /** Optional full-bleed picture behind the opening lines, heavily dimmed. */
      hookBackdrop: ImageRefSchema.optional(),
    })
    .default({}),

  /** Which result the evidence beat opens, by rank (1 = the top place). */
  spotlight: z.number().int().min(1).default(1),
  /** How many result cards the dossier shows. */
  visiblePlaces: z.number().int().min(1).max(15).default(9),

  timing: TimingSchema.default({}),

  audio: z
    .object({
      /** A music file under `public/` or an https URL. None by default. */
      music: z.string().min(1).optional(),
      volume: z.number().min(0).max(1).default(0.55),
      /** Quiet interface sounds: clicks, keys, the pin landing, a chime. */
      sfx: z.boolean().default(true),
      sfxVolume: z.number().min(0).max(1).default(0.8),
    })
    .default({}),

  /**
   * The results, imported from a real run with `pnpm video:import <jobId>`.
   * Typed as `unknown` on the way in because a JSON import widens every enum
   * to `string`; it is validated here like everything else.
   */
  run: z.unknown().pipe(RunSnapshotSchema),
});

export type ScenarioInput = z.input<typeof ScenarioSchema>;
export type Scenario = z.output<typeof ScenarioSchema>;

/** What a render is for: the MP4, or the README GIF. */
export type Variant = "video" | "gif";

/**
 * The scenario as a variant renders it. The GIF runs on its own frame rate —
 * every beat is timed in seconds, so the choreography follows — and carries
 * no sound, since a GIF cannot play any.
 */
export function scenarioFor(scenario: Scenario, variant: Variant): Scenario {
  if (variant !== "gif") return scenario;
  return {
    ...scenario,
    video: { ...scenario.video, fps: scenario.gif.fps },
    audio: { ...scenario.audio, sfx: false, music: undefined },
  };
}

/**
 * Validate a scenario, and say exactly which field is wrong when it is not.
 * Called at module load by every scenario file.
 */
export function defineScenario(input: ScenarioInput): Scenario {
  const parsed = ScenarioSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const where = typeof input.id === "string" ? `scenario "${input.id}"` : "a scenario";
  const lines = parsed.error.issues.map(
    (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
  throw new Error(`Invalid ${where}:\n${lines.join("\n")}`);
}
