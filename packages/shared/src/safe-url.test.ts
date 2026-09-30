import { describe, expect, it } from "vitest";
import { isAccountAvatar, isSafePhotoUrl, safePhotoUrl } from "./safe-url.ts";

// The URL shapes run 34d414fb stored as restaurant thumbnails, and the place
// photos that share their host.
const AVATAR_DASH = "https://lh3.googleusercontent.com/a-/ALV-UjW5qj=w36-h36-p-rp-mo-br100";
const AVATAR = "https://lh3.googleusercontent.com/a/ACg8ocK4=s40-c-rp-mo-br100";
const PLACE_PHOTOS = [
  "https://lh3.googleusercontent.com/grass-cs/ANxoTn2=w80-h106-k-no",
  "https://lh3.googleusercontent.com/gps-cs-s/AHRPTWmLbRk36wU9=w80-h106-k-no",
  "https://lh5.googleusercontent.com/p/AF1QipN=w408-h240-k-no",
];

describe("isAccountAvatar", () => {
  it("recognises a Google account picture under /a/ and /a-/", () => {
    expect(isAccountAvatar(AVATAR_DASH)).toBe(true);
    expect(isAccountAvatar(AVATAR)).toBe(true);
    expect(isAccountAvatar("https://lh6.googleusercontent.com/a/default-user=w36-h36")).toBe(true);
  });

  it("is not dodged by the spellings that name the same host", () => {
    expect(isAccountAvatar("https://LH3.GoogleUserContent.com/a/ACg8ocK4")).toBe(true);
    expect(isAccountAvatar("https://lh3.googleusercontent.com./a-/ALV-UjW5qj")).toBe(true);
    expect(isAccountAvatar("https://googleusercontent.com/a/ACg8ocK4")).toBe(true);
    // Not a photo URL either way, but still a face.
    expect(isAccountAvatar("http://lh3.googleusercontent.com/a/ACg8ocK4")).toBe(true);
  });

  it("leaves the place photos on the same host alone", () => {
    for (const url of PLACE_PHOTOS) expect(isAccountAvatar(url)).toBe(false);
    // The prefix is the whole first segment, not any path starting with "a".
    expect(isAccountAvatar("https://lh3.googleusercontent.com/ab/c")).toBe(false);
    expect(isAccountAvatar("https://lh3.googleusercontent.com/a-b/c")).toBe(false);
    expect(isAccountAvatar("https://lh3.googleusercontent.com/p/a/c")).toBe(false);
  });

  it("only speaks for Google's host", () => {
    // A restaurant's own `/a/` directory is its business, and a lookalike
    // host is just another third party: neither is a Google account picture.
    expect(isAccountAvatar("https://panella.ca/a/og.jpg")).toBe(false);
    expect(isAccountAvatar("https://googleusercontent.com.evil.example/a/x")).toBe(false);
    expect(isAccountAvatar("https://evilgoogleusercontent.com/a/x")).toBe(false);
  });

  it("is false for garbage rather than throwing", () => {
    expect(isAccountAvatar("")).toBe(false);
    expect(isAccountAvatar("not a url")).toBe(false);
    expect(isAccountAvatar("/a/ACg8ocK4")).toBe(false);
  });
});

describe("isSafePhotoUrl", () => {
  it("refuses a reviewer's account picture as a photo of the place", () => {
    expect(isSafePhotoUrl(AVATAR_DASH)).toBe(false);
    expect(isSafePhotoUrl(AVATAR)).toBe(false);
  });

  it("still accepts a Google place photo, which shares the avatar's host", () => {
    for (const url of PLACE_PHOTOS) expect(isSafePhotoUrl(url)).toBe(true);
  });
});

describe("safePhotoUrl", () => {
  it("filters an account picture out, padding and all", () => {
    expect(safePhotoUrl(`  ${AVATAR_DASH}  `)).toBeUndefined();
    expect(safePhotoUrl(` ${PLACE_PHOTOS[0]!} `)).toBe(PLACE_PHOTOS[0]);
  });
});
