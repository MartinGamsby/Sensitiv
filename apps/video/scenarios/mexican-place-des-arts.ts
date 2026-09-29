import { defineScenario } from "../src/config/scenario.ts";
// The results: run 34d414fb, a real search for exactly this — pinned at Place
// des Arts, 1 km, celiac with restaurants only, "Mexican restaurant", every
// source live. Refresh it after a new run with:
//   pnpm video:import <jobId> mexican-place-des-arts
import run from "./mexican-place-des-arts.run.json";

// Everything this video says and shows. Edit freely, then preview with
// `pnpm video:studio` or render with `pnpm video mexican-place-des-arts`.
//
// Text: any string below. {placeholders} are filled from the run — {places}
// {evidence} {radius} {pin} {request} {requirement} {location} {sources}
// {duration} — and *asterisks* colour a word in the brand teal.
//
// Images: a path under `apps/video/public/` or an https URL (downloaded once
// into a local cache). Place photos come from the run; override any of them
// in `images.photos`.

export default defineScenario({
  id: "mexican-place-des-arts",

  video: { width: 1920, height: 1080, fps: 30 },
  theme: "dark",
  locale: "en",

  brand: {
    name: "Sensitiv",
    tagline: "Tell it where, and what has to be true. It brings back the evidence.",
    // logo: "brand/logo.png",
    address: "localhost:3000",
  },

  // What the demo types into the form.
  search: {
    request: "Mexican restaurant",
    requirement: "celiac",
    intents: ["dining"], // restaurants only
    pin: { lat: 45.508, lng: -73.5686, label: "Place des Arts" },
    locationText: "Ville-Marie, Montreal, Quebec",
    radiusKm: 1,
  },

  copy: {
    hook: [
      "Celiac, and craving tacos.",
      "“Gluten-free options” isn't the same as *safe*.",
      "The proof is buried in *reviews*, *listings* and *menus*.",
    ],
    captions: {
      where: {
        kicker: "1",
        title: "Tell it where",
        body: "A pin on {pin}. Search within {radius} km.",
      },
      requirement: {
        kicker: "2",
        title: "Say what has to be true",
        body: "{requirement} — restaurants only.",
      },
      request: {
        kicker: "3",
        title: "Say what you're after",
        body: "“{request}.”",
      },
      research: {
        title: "Sensitiv does the legwork",
        body: "A cloud browser searches {sources}, then reads listings, reviews and websites.",
      },
      dossier: {
        title: "A ranked dossier",
        body: "{places} places, each scored against what you asked for.",
      },
      evidence: {
        title: "Every score shows its evidence",
        body: "The quote, who said it, and what it was worth.",
      },
      map: {
        title: "Mapped around your pin",
        body: "Every result, ranked, around {pin}.",
      },
    },
    outro: {
      headline: "Know before you go.",
      body: "Research assistance for requirements you can't compromise on.",
    },
  },

  images: {
    // Per place name: a replacement photo, or null for the initials tile.
    photos: {
      // "La Selva restaurant mexicain": "photos/la-selva.jpg",
    },
    // hookBackdrop: "backdrops/tacos.jpg",
  },

  // Which result the evidence beat opens (1 = the top place).
  spotlight: 1,
  visiblePlaces: 9,

  // Seconds per beat; see TimingSchema in src/config/scenario.ts for them all.
  timing: {},

  audio: {
    // music: "audio/track.mp3",
    volume: 0.55,
  },

  run,
});
