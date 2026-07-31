#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probe } from './lib/ffmpeg.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, 'dist')
const PUBLIC_CLIPS = resolve(HERE, '..', '..', 'apps', 'web', 'public', 'clips')

const cfg = JSON.parse(await readFile(join(HERE, 'clips.manifest.json'), 'utf-8'))
const failures = []

function check(cond, msg) {
  if (!cond) failures.push(msg)
}

/**
 * A speed-ramped clip is deliberately shorter than out - in: play normally to
 * `from`, compress `from`-`to` by `factor`, then resume normal speed to `out`.
 * Mirrors the setpts math in encode.mjs so a regression there shows up here
 * as a duration mismatch instead of silently passing.
 *
 * Deliberate limitation: this shares its inputs with the encoder, so it proves the
 * arithmetic is self-consistent and nothing more. A ramp window aimed at entirely
 * the wrong footage — compressing the interesting part instead of a dead wait —
 * produces a correct duration and passes. Watch a ramped clip before committing it.
 */
function expectedDuration(clip) {
  if (!clip.speedRamp) return clip.out - clip.in
  const { from, to, factor } = clip.speedRamp
  return from - clip.in + (to - from) / factor + (clip.out - to)
}

/** Bounds the encoder itself does not enforce; a transposed window is otherwise silent. */
function checkRampBounds(clip) {
  if (!clip.speedRamp) return
  const { from, to, factor } = clip.speedRamp
  check(
    from >= clip.in && from < to && to <= clip.out,
    `${clip.id}: speedRamp window ${from}-${to} must satisfy in <= from < to <= out ` +
      `(in ${clip.in}, out ${clip.out})`
  )
  check(factor > 1, `${clip.id}: speedRamp factor ${factor} must be > 1 to compress`)
}

for (const clip of cfg.clips) {
  const expected = expectedDuration(clip)
  checkRampBounds(clip)

  for (const [ext, codec] of [
    ['mp4', 'h264'],
    ['webm', 'vp9']
  ]) {
    const file = join(DIST, `${clip.id}.${ext}`)
    if (!existsSync(file)) {
      failures.push(`${clip.id}: missing ${ext}`)
      continue
    }
    const info = await probe(file)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const bytes = statSync(file).size

    check(v?.codec_name === codec, `${clip.id}.${ext}: codec ${v?.codec_name} != ${codec}`)
    check(
      Number(v?.width) === cfg.targetWidth,
      `${clip.id}.${ext}: width ${v?.width} != ${cfg.targetWidth}`
    )
    check(
      !info.streams.some((s) => s.codec_type === 'audio'),
      `${clip.id}.${ext}: has an audio stream; -an was expected`
    )
    check(
      bytes <= cfg.maxBytes,
      `${clip.id}.${ext}: ${Math.round(bytes / 1024)}KB exceeds ceiling ${Math.round(
        cfg.maxBytes / 1024
      )}KB`
    )
    const actual = Number(info.format.duration)
    check(
      Math.abs(actual - expected) < 0.5,
      `${clip.id}.${ext}: duration ${actual.toFixed(2)}s != ${expected.toFixed(2)}s`
    )

    // Local dev's CLIP_BASE ("/clips") serves out of apps/web/public/clips,
    // not tools/feature-clips/dist, so this copy is what actually proves the
    // clip plays locally rather than just that it encoded.
    const publicFile = join(PUBLIC_CLIPS, `${clip.id}.${ext}`)
    if (!existsSync(publicFile)) {
      failures.push(`${clip.id}: missing public copy at ${publicFile}`)
    } else {
      check(
        statSync(publicFile).size === bytes,
        `${clip.id}.${ext}: public copy size ${statSync(publicFile).size} != dist copy ${bytes}`
      )
    }
  }

  const poster = join(PUBLIC_CLIPS, `${clip.id}.webp`)
  if (!existsSync(poster)) {
    failures.push(`${clip.id}: missing poster at ${poster}`)
  } else {
    const info = await probe(poster)
    const v = info.streams.find((s) => s.codec_type === 'video')
    check(v?.codec_name === 'webp', `${clip.id} poster: codec ${v?.codec_name} != webp`)
    check(
      Number(v?.width) === cfg.targetWidth,
      `${clip.id} poster: width ${v?.width} != ${cfg.targetWidth}`
    )
  }

  // GIFs are README/social only, never served to the site, so they are
  // deliberately not held to the mp4/webm `maxBytes` ceiling — an 11s GIF
  // cannot meet it. They still get real assertions rather than none.
  if (clip.gif) {
    const gif = join(DIST, `${clip.id}.gif`)
    if (!existsSync(gif)) {
      failures.push(`${clip.id}: missing gif at ${gif}`)
    } else {
      const info = await probe(gif)
      const v = info.streams.find((s) => s.codec_type === 'video')
      check(v?.codec_name === 'gif', `${clip.id}.gif: codec ${v?.codec_name} != gif`)
      check(
        Number(v?.width) === cfg.gifWidth,
        `${clip.id}.gif: width ${v?.width} != ${cfg.gifWidth}`
      )
      const frames = Number(v?.nb_frames)
      check(
        Number.isFinite(frames) && frames > 0,
        `${clip.id}.gif: nb_frames ${v?.nb_frames} is not a sane positive count`
      )
    }
  }
}

if (failures.length) {
  console.error('✗ verification failed:')
  for (const f of failures) console.error('  -', f)
  process.exit(1)
}
console.log(`✓ verified ${cfg.clips.length} clip(s)`)
