import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLIP_BASE, FEATURE_CLIPS, mp4Url, posterUrl, webmUrl } from "../feature-clips";

const POSTER_DIR = resolve(__dirname, "..", "..", "..", "..", "public", "clips");
const ENCODE_MANIFEST = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "tools",
  "feature-clips",
  "clips.manifest.json",
);

// Only the four captured clips have a video encode; the three motion graphics
// (ssh-tunnel, local-vault, no-telemetry) are CSS/SVG components with no
// mp4/webm/poster and no counterpart in the encode manifest by design.
const videoClips = FEATURE_CLIPS.filter((c) => c.media.kind === "video");

describe("feature clip manifest", () => {
  it("has unique ids", () => {
    const ids = FEATURE_CLIPS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses kebab-case ids so the URL hash is stable", () => {
    for (const clip of FEATURE_CLIPS) {
      expect(clip.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("has a committed poster for every video clip", () => {
    for (const clip of videoClips) {
      if (clip.media.kind !== "video") continue;
      const poster = resolve(POSTER_DIR, `${clip.media.file}.webp`);
      expect(existsSync(poster), `missing poster for ${clip.id}: ${poster}`).toBe(true);
    }
  });

  it("has no orphaned posters", () => {
    const referenced = new Set(
      videoClips.map((c) => (c.media.kind === "video" ? `${c.media.file}.webp` : "")),
    );
    const onDisk = readdirSync(POSTER_DIR).filter((f) => f.endsWith(".webp"));
    for (const file of onDisk) {
      expect(referenced.has(file), `orphaned poster: ${file}`).toBe(true);
    }
  });

  it("builds well-formed R2 and poster URLs", () => {
    for (const clip of videoClips) {
      if (clip.media.kind !== "video") continue;
      expect(mp4Url(clip.media.file)).toBe(`${CLIP_BASE}/${clip.media.file}.mp4`);
      expect(webmUrl(clip.media.file)).toBe(`${CLIP_BASE}/${clip.media.file}.webm`);
      expect(posterUrl(clip.media.file)).toBe(`/clips/${clip.media.file}.webp`);
      expect(CLIP_BASE.startsWith("https://") || CLIP_BASE === "/clips").toBe(true);
    }
  });

  it("stays in sync with the encode manifest (video clips only)", () => {
    const encode = JSON.parse(readFileSync(ENCODE_MANIFEST, "utf-8")) as {
      clips: { id: string }[];
    };
    const encodeIds = new Set(encode.clips.map((c) => c.id));
    for (const clip of videoClips) {
      if (clip.media.kind !== "video") continue;
      expect(
        encodeIds.has(clip.media.file),
        `${clip.media.file} is on the site but not in clips.manifest.json`,
      ).toBe(true);
    }
  });

  it("gives every clip a title and a blurb", () => {
    for (const clip of FEATURE_CLIPS) {
      expect(clip.title.length).toBeGreaterThan(2);
      expect(clip.blurb.length).toBeGreaterThan(20);
    }
  });
});
