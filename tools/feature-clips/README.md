# Feature clips

Marketing clips for the features shown at datapeek.dev — real captures of the
desktop app, not mockups or hand-drawn animations.

Shipped set: four video clips (`command-palette`, `query-plans`, `er-diagram`,
`data-masking`) and three CSS/SVG motion graphics for features with nothing to
film (`ssh-tunnels`, `local-credentials`, `no-telemetry`, under
`apps/web/src/components/marketing/motion/`). `watch-mode` was captured but is
**not** shipped — a real product bug blocks it: diff highlights (the amber
changed-cell background, the green added-row band) never render for a result
of 50 rows or fewer, because the decoration overlay is gated behind
`shouldVirtualize` in both grid components. That is nearly every realistic
query. See `notes/_watch-mode-bugs.md` for the writeup (Bug 2 — a related,
already-fixed bug, Bug 1, meant the grid didn't even repaint cell _text_ on a
tick; that one is not what blocks shipping). Do not add it back to the site
without fixing Bug 2 first.

## Pipeline

    apps/desktop: pnpm capture               # Playwright drives the built app -> footage/*.webm
    node encode.mjs [clip-id]                # ffmpeg -> dist/*.{mp4,webm,gif} + posters
    node verify.mjs                          # ffprobe assertions; non-zero exit on failure
    op run -- node upload.mjs                # -> R2 bucket's clips/ prefix

## Requirements

- Docker (the capture harness starts a seeded Postgres container per worker)
- A built desktop app — `pnpm capture` (in `apps/desktop`) builds first
- ffmpeg on PATH
- `cwebp` on PATH for posters — the ffmpeg build used here has no `libwebp`,
  so posters go through a PNG frame grab + `cwebp -q 82` rather than ffmpeg's
  own webp encoder
- Note: `gifski` is broken on at least one dev machine this pipeline was built
  on (it links `ffmpeg@6`'s `libvpx.11.dylib`, which newer `libvpx` no longer
  ships), so GIFs are produced without it — ffmpeg's own two-pass
  `palettegen`/`paletteuse` from the already-encoded MP4. If you reinstall a
  working `gifski`, swapping it back in is optional, not required.

Captures never run in CI — they need Docker, a built Electron app, and a
desktop session (`playwright.capture.config.ts` is deliberately outside
`playwright.config.ts` for this reason). Site-side tests (the manifest
integrity check in `apps/web`) do run in CI.

## Conventions

- **One id, four places.** A clip's id is the same string as: the Playwright
  test title in `apps/desktop/tests/capture/<id>.capture.ts`, the footage
  filename (`footage/<id>.webm`), the `id` in `clips.manifest.json`, and
  `media.file` in `apps/web/src/components/marketing/feature-clips.ts`. Keep
  all four in sync when adding, renaming, or removing a clip.
- **Every capture spec must assert on the state it films.** This is the
  single most important convention here. A spec that opens the app, does
  nothing meaningful, and passes has already happened on this project —
  twice, for `watch-mode`, producing footage of a table that never visibly
  changed. Assert the thing the clip is supposed to prove is actually on
  screen (e.g. `data-masking.capture.ts` asserts a `blur` style is present
  before considering the clip done) so a UI regression fails the capture run
  instead of silently shipping a clip of nothing.
- **Playwright's CDP screencast draws no OS cursor.** Click-driven flows are
  unreadable without one, so `tests/capture/fixtures/cursor.ts` injects a
  synthetic pointer plus a keycap HUD (shows the keystroke that caused an
  effect — for a keyboard-first tool that's part of the point, not
  decoration) and moves both in lockstep with `page.mouse`.
- **Capture size vs. encode size.** Captured at 1728x1080 (not the app's
  narrower default — the editor layout overlaps the sidebar below ~1720px),
  encoded down to 1280x800. 1728 is exactly a 1.6 ratio so `scale=1280:-2`
  lands on an even 1280x800 with no rounding. 25fps end to end, matching
  Playwright's screencast rate — encoding at 30fps would just duplicate
  frames. No audio (`-an`). Dark theme only; the harness pins
  `data-peek-theme` to `dark` before first paint.
- **`verify.mjs` enforces a 350KB ceiling per mp4/webm** and it has already
  rejected real footage twice (`query-plans` at 497-552KB, `er-diagram` at
  604KB). When a clip is over, **trim the footage, don't raise CRF** —
  text-heavy UI (SQL, plan trees, schema labels) compresses badly, and an
  over-long clip is a bad autoplay loop anyway regardless of size. Both
  rejected clips were fixed this way: 12 of `query-plans`' original seconds
  were the query being typed, before any plan tree had rendered — cutting
  that preamble shrank the file and improved the clip. Re-encode after
  trimming the `in`/`out` (and `posterAt`) in `clips.manifest.json`, not by
  fighting the encoder.
- **GIFs are README/social only**, never served to the site — the `mp4`/`webm`
  pair is roughly a fourth the size. `command-palette` is the one clip built
  with `"gif": true` (707KB) versus its own 193KB MP4 at higher resolution
  and frame rate: that gap is the evidence for serving the site from
  video, not GIF.
- **`CLIP_BASE` is env-driven.** `NEXT_PUBLIC_CLIP_BASE` points at the R2
  bucket in production; local dev falls back to `/clips`, served straight out
  of `apps/web/public/clips/`. `encode.mjs` writes the mp4/webm into that
  directory too (gitignored — see `.gitignore`) alongside `dist/`, so local
  dev plays real video instead of a poster over a 404. The `.webp` poster is
  committed to `apps/web/public/clips/`; it is not uploaded to R2.

## Uploading to R2

`upload.mjs` reads credentials from the environment only — never from a file
in this repo, never a CLI argument, never hardcoded. Required:

- `R2_BUCKET`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Recommended, via 1Password (see the `1password` skill / `op run`):

```bash
cd tools/feature-clips
op run -- node upload.mjs
```

Or export them for the shell session:

```bash
export R2_BUCKET=<bucket-name>
export CLOUDFLARE_API_TOKEN=<token>
export CLOUDFLARE_ACCOUNT_ID=<account-id>
node upload.mjs
```

If you'd rather not manage a token, `npx wrangler login` authenticates
interactively — but `upload.mjs` will still ask for the three env vars above
rather than silently trusting whatever wrangler session happens to be active.
That's deliberate: a dev machine can have a wrangler login for an entirely
different Cloudflare account already active, and this script has no way to
tell that account apart from the right one. If you've logged in that way,
upload manually instead of through this script:

```bash
npx wrangler r2 object put <bucket>/clips/<file> --file dist/<file> \
  --content-type <video/mp4|video/webm|image/gif> --remote
```

`upload.mjs` never prints, logs, or writes a credential value anywhere, even
on failure — only the _names_ of missing variables.

`.env.example` in this directory documents the three variable names with
placeholder values; it is not read by the script and must never contain real
credentials.

## Refreshing README imagery

`README.md` (repo root) currently embeds static PNGs from R2. Once a clip's
GIF has actually been uploaded (`node upload.mjs` succeeded and
`curl -sI <bucket-url>/clips/<id>.gif` returns 200), it can replace the
matching static screenshot with:

```html
<img src="<bucket-url>/clips/<id>.gif" alt="<description>" width="100%" />
```

Do this per clip, only after confirming the upload — don't point the README
at a GIF that doesn't exist yet. Weigh the size too: `command-palette.gif` is
707KB versus a 193KB MP4 of the same clip, so a README swap is a real
bandwidth trade for GitHub visitors, not a free upgrade. It may be worth
converting only the clips where the static PNG is clearly worse (e.g. clips
whose whole point is motion, like the palette narrowing as you type) rather
than replacing every screenshot.

## Speed ramps

A clip whose footage contains a long dead wait — a local LLM thinking, a slow
import — can compress that stretch instead of shipping it. Add to the manifest
entry:

    "speedRamp": { "from": 16.0, "to": 32.6, "factor": 5 }

`from`/`to` are timestamps in the **source** footage, and the output runs
`(from - in) + (to - from) / factor + (out - to)` seconds.

**`verify.mjs` cannot tell you the window is aimed at the right thing.** It shares
its inputs with the encoder, so it only proves the arithmetic is self-consistent —
a ramp that compresses the interesting part instead of the dead wait produces a
correct duration and passes. It does now reject an out-of-order or out-of-range
window (`in <= from < to <= out`) and a `factor` of 1 or less, but semantics are
yours to check: **watch a ramped clip before committing it.**

## Adding a new clip

1. Write `apps/desktop/tests/capture/<id>.capture.ts`. The test title is the
   clip id. Assert on the state it films — see "Conventions" above.
2. `cd apps/desktop && pnpm capture -- -g <id>`, then check
   `tools/feature-clips/footage/<id>.webm` and note the `in`/`out` timestamps
   you want (and a `posterAt` inside that range).
3. Add an entry to `clips.manifest.json`.
4. `node encode.mjs <id> && node verify.mjs`.
5. Add an entry to `apps/web/src/components/marketing/feature-clips.ts`
   (`FEATURE_CLIPS`) with a matching `media.file`.
6. `cd apps/web && pnpm test` — `feature-clips.test.ts` checks the site
   manifest stays in sync with `clips.manifest.json` and that every clip has
   a poster.
7. `op run -- node upload.mjs`.

## Re-capturing after a UI change

Capture specs assert on the flows they film, so a moved button or renamed
label fails the capture run rather than quietly emitting a broken clip.
Re-run the affected capture, re-check its `in`/`out`/`posterAt` timestamps
against the new footage, re-encode, re-verify, re-upload.
