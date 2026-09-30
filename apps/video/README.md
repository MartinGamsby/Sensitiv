# @sensitiv/video

Generates the Sensitiv demo video from a scenario file: a recreation of the app's own UI
(form → research → dossier → evidence → map), driven by the results of a **real run**
imported from your local database. Built with [Remotion](https://www.remotion.dev).

```
pnpm video                      # render the default scenario → apps/video/out/<id>.mp4
pnpm video <scenario-id> | all  # a given scenario, or every one
pnpm video:gif [<id> | all]     # the README GIF → docs/<id>.gif (~20 MB, ~40 s)
pnpm video:studio               # live preview with a timeline; edits hot-reload
pnpm video:import <jobId> <id>  # freeze a finished run into scenarios/<id>.run.json
pnpm video:assets [--offline]   # warm the cache (the commands above do this first)
```

The first render downloads Remotion's headless Chrome (~110 MB) and about a hundred
OpenStreetMap tiles; both are cached.

The GIF is rendered from the same composition, not converted from the MP4: it keeps the
background and the camera still between moves, because a GIF stores unchanged pixels
almost for free — a straight conversion of the MP4 comes to 25–60 MB.

Remotion's CLI prints a "Version mismatch" warning about zod 4: that is for its optional
visual props editor, which this package does not use (it validates with the repo's zod 3).

## Changing what the video says and shows

Everything lives in one file per video, e.g. [`scenarios/mexican-place-des-arts.ts`](scenarios/mexican-place-des-arts.ts):

| Section | What it controls |
|---|---|
| `copy` | Every sentence: opening lines, per-step captions, the agent panel's labels, the closing card. `{placeholders}` (`{places}`, `{pin}`, `{radius}`, `{request}`, `{requirement}`, `{sources}`, `{duration}`…) are filled from the run; `*asterisks*` colour a word. |
| `search` | What the demo types: request, requirement chip, intents (`["dining"]` = restaurants only), pin + its label, radius. |
| `images` | `photos`: per place name, a replacement photo or `null` for the initials tile. `hookBackdrop`: a picture behind the opening lines. |
| `brand` | Name, tagline, logo, the address bar text. |
| `video`, `theme`, `locale` | Size, fps, `dark`/`light`, `en`/`fr` (the UI labels come from `apps/web/messages`). |
| `timing` | Seconds per beat; any subset (see `TimingSchema` in `src/config/scenario.ts`). |
| `audio` | `music` (a file or URL, none by default), `volume`, `sfx` (interface sounds, on), `sfxVolume`. |
| `spotlight`, `visiblePlaces` | Which result the evidence beat opens; how many cards show. |
| `gif` | `width`, `fps`, `colors` of the README GIF (800, 12, 128). Lower any of them for a smaller file. |

Images and music are a path under `apps/video/public/` or an https URL. URLs are fetched
once into `public/cache/` (git-ignored) with the same limits as the app's photo route
(https only, no redirects, 5 MB, raster types only); a render never touches the network.
A file that cannot be fetched falls back — a photo becomes the initials tile — instead of
failing the render.

A new video: copy a scenario file, give it a new `id`, list it in
[`scenarios/index.ts`](scenarios/index.ts).

## The results are real

`scenarios/<id>.run.json` is a finished run, frozen: places, scores, quotes, the activity
log. Every number, quote and log line in the video is one the app produced — the video
restyles it, it never invents it. `pnpm video:import`:

- refuses a run that used recorded **sample data** for any source (`--allow-sample-data`
  imports it anyway, and the video then shows the app's own sample-data warning);
- drops photos that are a reviewer's Google account picture rather than the place;
- keeps no URLs, and drops the log line naming the browser session.

Re-importing overwrites hand edits to the `.run.json`.

## Before publishing a video

- **Remotion's license** is free for individuals and companies of up to three people;
  larger companies need a [company license](https://www.remotion.dev/license).
- Place **photos** come from the run's Google Maps listings and belong to their owners.
  Replace them in `images.photos` (or set `null`) if you don't have the right to use them.
- **Map tiles** are © OpenStreetMap contributors; the credit is drawn on every map, as in
  the app. The font is Inter (SIL Open Font License), from `@fontsource-variable/inter`.
