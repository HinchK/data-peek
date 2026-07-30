#!/usr/bin/env node
import { mkdirSync, existsSync, rmSync, copyFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './lib/ffmpeg.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FOOTAGE = join(HERE, 'footage')
const DIST = join(HERE, 'dist')
// Local dev's CLIP_BASE ("/clips") serves straight out of this directory, so
// the mp4/webm land here too, not just the poster. Production instead points
// CLIP_BASE at R2 (see feature-clips.ts) — these two binaries are gitignored
// and only the .webp poster is committed.
const PUBLIC_CLIPS = resolve(HERE, '..', '..', 'apps', 'web', 'public', 'clips')

const cfg = JSON.parse(await readFile(join(HERE, 'clips.manifest.json'), 'utf-8'))
const only = process.argv[2]
const clips = only ? cfg.clips.filter((c) => c.id === only) : cfg.clips
if (only && clips.length === 0) {
  throw new Error(`No clip with id "${only}" in clips.manifest.json`)
}

mkdirSync(DIST, { recursive: true })
mkdirSync(PUBLIC_CLIPS, { recursive: true })

/**
 * Piecewise-linear setpts for a speed ramp: play normally up to `a`, compress
 * the `a`-`b` window by `factor`, then resume normal speed to the end of the
 * clip, on one continuous monotonic timeline.
 *
 * `T` (ffmpeg's per-frame timestamp) is in seconds; `PTS` is in timebase
 * units, so a result computed in the seconds domain has to be divided by
 * `TB` before it can replace PTS. The whole expression is wrapped in single
 * quotes, which is ffmpeg's filtergraph escaping for the commas inside it.
 */
function speedRampExpr(a, b, factor) {
  const ramp = `(${a}+(T-${a})/${factor})/TB`
  const rest = `(${a}+(${b}-${a})/${factor}+(T-${b}))/TB`
  return `setpts='if(lt(T,${a}),PTS,if(lt(T,${b}),${ramp},${rest}))'`
}

/**
 * Build the -vf chain: trim -> rebase the timeline to 0 -> optional speed ramp
 * -> scale + fps normalise.
 *
 * The trim happens inside the filtergraph (`trim` + `setpts=PTS-STARTPTS`)
 * rather than via CLI `-ss`/`-t`, and that is load-bearing, not stylistic:
 * `-ss`/`-t` placed after `-i` only cut at the muxer, downstream of every
 * filter including setpts, so a speed ramp's `T` would still be measured
 * against the *whole source's* absolute timestamps rather than the trimmed
 * clip's. Doing the trim as the first two filter steps guarantees `T` is
 * 0-based at `clip.in` for everything after it, which is what `from`/`to`
 * below are rebased against. Confirmed empirically: this is also what keeps
 * the frame-accurate behaviour the old `-ss` placement was chasing (decoding
 * from the start rather than snapping to a VP8 keyframe), since nothing here
 * does an early/coarse seek either.
 */
function videoFilter(clip) {
  const chain = [`trim=start=${clip.in}:end=${clip.out}`, 'setpts=PTS-STARTPTS']
  if (clip.speedRamp) {
    const { from, to, factor } = clip.speedRamp
    // Relative to the trimmed clip (now 0-based at clip.in), not the source.
    const a = (from - clip.in).toFixed(3)
    const b = (to - clip.in).toFixed(3)
    chain.push(speedRampExpr(a, b, factor))
  }
  chain.push(`scale=${cfg.targetWidth}:-2:flags=lanczos`)
  chain.push(`fps=${cfg.fps}`)
  return chain.join(',')
}

for (const clip of clips) {
  const src = join(FOOTAGE, `${clip.id}.webm`)
  if (!existsSync(src)) {
    throw new Error(`Missing footage: ${src}. Capture it first.`)
  }
  const duration = (clip.out - clip.in).toFixed(3)
  console.log(`▶ ${clip.id} (${duration}s)`)

  const trim = ['-i', src]
  const vf = videoFilter(clip)

  await run('ffmpeg', [
    '-y',
    ...trim,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-preset',
    'slow',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    join(DIST, `${clip.id}.mp4`)
  ])
  copyFileSync(join(DIST, `${clip.id}.mp4`), join(PUBLIC_CLIPS, `${clip.id}.mp4`))
  console.log('  mp4')

  await run('ffmpeg', [
    '-y',
    ...trim,
    '-vf',
    vf,
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '32',
    '-b:v',
    '0',
    '-row-mt',
    '1',
    '-an',
    join(DIST, `${clip.id}.webm`)
  ])
  copyFileSync(join(DIST, `${clip.id}.webm`), join(PUBLIC_CLIPS, `${clip.id}.webm`))
  console.log('  webm')

  // Homebrew's ffmpeg ships without libwebp, so the poster goes via PNG and
  // cwebp (part of the same `webp` formula that provides the decoder).
  const posterPng = join(DIST, `.poster-${clip.id}.png`)
  try {
    await run('ffmpeg', [
      '-y',
      '-i',
      src,
      '-ss',
      String(clip.posterAt),
      '-frames:v',
      '1',
      '-vf',
      `scale=${cfg.targetWidth}:-2:flags=lanczos`,
      posterPng
    ])
    await run('cwebp', [
      '-quiet',
      '-q',
      '82',
      posterPng,
      '-o',
      join(PUBLIC_CLIPS, `${clip.id}.webp`)
    ])
  } finally {
    rmSync(posterPng, { force: true })
  }
  console.log('  poster')

  // GIFs are for the README and social only — never served to the site, where the
  // MP4/WebM pair is an order of magnitude smaller. Derived from the MP4 we just
  // wrote, which is already trimmed and scaled, so there is no second trim to keep
  // in sync. Two-pass palettegen/paletteuse rather than gifski: it needs no extra
  // dependency, and UI footage is flat-coloured enough that a 256-colour adaptive
  // palette holds up.
  if (clip.gif) {
    const gifSrc = join(DIST, `${clip.id}.mp4`)
    const palette = join(DIST, `.palette-${clip.id}.png`)
    const gifScale = `fps=${cfg.gifFps},scale=${cfg.gifWidth}:-2:flags=lanczos`
    try {
      await run('ffmpeg', [
        '-y',
        '-i',
        gifSrc,
        '-vf',
        `${gifScale},palettegen=stats_mode=diff`,
        palette
      ])
      await run('ffmpeg', [
        '-y',
        '-i',
        gifSrc,
        '-i',
        palette,
        '-filter_complex',
        `[0:v]${gifScale}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
        join(DIST, `${clip.id}.gif`)
      ])
    } finally {
      rmSync(palette, { force: true })
    }
    console.log('  gif')
  }
}

console.log(`\n✓ encoded ${clips.length} clip(s) → ${DIST}`)
