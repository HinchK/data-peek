#!/usr/bin/env node
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './lib/ffmpeg.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FOOTAGE = join(HERE, 'footage')
const DIST = join(HERE, 'dist')
const POSTERS = resolve(HERE, '..', '..', 'apps', 'web', 'public', 'clips')

const cfg = JSON.parse(await readFile(join(HERE, 'clips.manifest.json'), 'utf-8'))
const only = process.argv[2]
const clips = only ? cfg.clips.filter((c) => c.id === only) : cfg.clips
if (only && clips.length === 0) {
  throw new Error(`No clip with id "${only}" in clips.manifest.json`)
}

mkdirSync(DIST, { recursive: true })
mkdirSync(POSTERS, { recursive: true })

/**
 * Build the -vf chain. `speedRamp` compresses a dead segment (e.g. waiting on a
 * local LLM) via setpts; everything else is a straight scale + fps normalise.
 */
function videoFilter(clip) {
  const chain = []
  if (clip.speedRamp) {
    const { from, to, factor } = clip.speedRamp
    // Relative to the trimmed clip, not the source.
    const a = (from - clip.in).toFixed(3)
    const b = (to - clip.in).toFixed(3)
    chain.push(`setpts='if(between(T,${a},${b}),PTS/${factor},PTS)'`)
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

  // Output-side seeking (-ss/-t after -i) is frame-accurate; input-side seeking on
  // VP8 snaps to keyframes and can drift the trim by up to a second.
  const trim = ['-i', src, '-ss', String(clip.in), '-t', duration]
  const vf = videoFilter(clip)

  await run('ffmpeg', [
    '-y', ...trim,
    '-vf', vf,
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    join(DIST, `${clip.id}.mp4`)
  ])
  console.log('  mp4')

  await run('ffmpeg', [
    '-y', ...trim,
    '-vf', vf,
    '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-an',
    join(DIST, `${clip.id}.webm`)
  ])
  console.log('  webm')

  // Homebrew's ffmpeg ships without libwebp, so the poster goes via PNG and
  // cwebp (part of the same `webp` formula that provides the decoder).
  const posterPng = join(DIST, `.poster-${clip.id}.png`)
  await run('ffmpeg', [
    '-y', '-i', src, '-ss', String(clip.posterAt), '-frames:v', '1',
    '-vf', `scale=${cfg.targetWidth}:-2:flags=lanczos`,
    posterPng
  ])
  await run('cwebp', [
    '-quiet', '-q', '82', posterPng, '-o', join(POSTERS, `${clip.id}.webp`)
  ])
  rmSync(posterPng, { force: true })
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
        '-y', '-i', gifSrc,
        '-vf', `${gifScale},palettegen=stats_mode=diff`,
        palette
      ])
      await run('ffmpeg', [
        '-y', '-i', gifSrc, '-i', palette,
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
