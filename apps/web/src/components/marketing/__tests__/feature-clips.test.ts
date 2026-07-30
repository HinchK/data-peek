import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLIP_BASE,
  FEATURE_CLIPS,
  mp4Url,
  posterUrl,
  webmUrl,
} from "../feature-clips";

const PRODUCTION_CLIP_BASE =
  "https://pub-84538e6ab6f94b80b94b8aa308ad1270.r2.dev/clips";

const POSTER_DIR = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "public",
  "clips",
);
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
      expect(
        existsSync(poster),
        `missing poster for ${clip.id}: ${poster}`,
      ).toBe(true);
    }
  });

  it("has no orphaned posters or video files", () => {
    const referenced = new Set(
      videoClips.flatMap((c) =>
        c.media.kind === "video"
          ? [
              `${c.media.file}.webp`,
              `${c.media.file}.mp4`,
              `${c.media.file}.webm`,
            ]
          : [],
      ),
    );
    const onDisk = readdirSync(POSTER_DIR).filter(
      (f) => f.endsWith(".webp") || f.endsWith(".mp4") || f.endsWith(".webm"),
    );
    for (const file of onDisk) {
      expect(referenced.has(file), `orphaned file: ${file}`).toBe(true);
    }
  });

  it("builds well-formed local-dev URLs when NEXT_PUBLIC_CLIP_BASE is unset", () => {
    // NEXT_PUBLIC_CLIP_BASE is never set in the Vitest pipeline (no .env
    // loading in vitest.config.ts, no stub in vitest.setup.ts), so the module
    // reliably falls back to "/clips" here. Assert the exact value rather
    // than a loose OR, so a regression that stops the fallback from working
    // actually fails this test.
    expect(CLIP_BASE).toBe("/clips");
    for (const clip of videoClips) {
      if (clip.media.kind !== "video") continue;
      expect(mp4Url(clip.media.file)).toBe(`/clips/${clip.media.file}.mp4`);
      expect(webmUrl(clip.media.file)).toBe(`/clips/${clip.media.file}.webm`);
      expect(posterUrl(clip.media.file)).toBe(`/clips/${clip.media.file}.webp`);
    }
  });

  describe("with NEXT_PUBLIC_CLIP_BASE set to the production R2 URL", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it("builds well-formed R2 URLs and keeps the poster local", async () => {
      vi.stubEnv("NEXT_PUBLIC_CLIP_BASE", PRODUCTION_CLIP_BASE);
      vi.resetModules();
      // feature-clips.ts reads process.env.NEXT_PUBLIC_CLIP_BASE at module
      // load time, so the stub above only takes effect on a fresh import.
      const prod = await import("../feature-clips");

      expect(prod.CLIP_BASE).toBe(PRODUCTION_CLIP_BASE);
      expect(prod.CLIP_BASE.startsWith("https://")).toBe(true);

      for (const clip of prod.FEATURE_CLIPS.filter(
        (c) => c.media.kind === "video",
      )) {
        if (clip.media.kind !== "video") continue;
        expect(prod.mp4Url(clip.media.file)).toBe(
          `${PRODUCTION_CLIP_BASE}/${clip.media.file}.mp4`,
        );
        expect(prod.webmUrl(clip.media.file)).toBe(
          `${PRODUCTION_CLIP_BASE}/${clip.media.file}.webm`,
        );
        // The poster always resolves under the app's own /public regardless
        // of where the video itself is served from.
        expect(prod.posterUrl(clip.media.file)).toBe(
          `/clips/${clip.media.file}.webp`,
        );
      }
    });
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
