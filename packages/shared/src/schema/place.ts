import { z } from "zod";

// A place as rendered in the dossier. `canonicalKey` is a normalized
// "name + street" used to merge the same place seen across multiple sources.
export const PlaceDetailSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  category: z.string().optional(),
  phone: z.string().optional(),
  url: z.string().optional(),
  canonicalKey: z.string().min(1),
});
export type PlaceDetail = z.infer<typeof PlaceDetailSchema>;

// One source's view of a place (a Google Maps listing, a Yelp page, ...).
export const PlaceSourceSchema = z.object({
  source: z.string().min(1),
  sourceUrl: z.string(),
  rating: z.number().optional(),
  reviewCount: z.number().int().nonnegative().optional(),
});
export type PlaceSource = z.infer<typeof PlaceSourceSchema>;
