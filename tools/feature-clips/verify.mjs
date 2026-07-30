#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probe } from './lib/ffmpeg.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, 'dist')
const POSTERS = resolve(HERE, '..', '..', 'apps', 'web', 'public', 'clips')

const cfg = JSON.parse(await readFile(join(HERE, 'clips.manifest.json'), 'utf-8'))
const failures = []

function check(cond, msg) {
  if (!cond) failures.push(msg)
}

for (const clip of cfg.clips) {
  // A speed-ramped clip is deliberately shorter than out - in, so its duration
  // cannot be asserted against the manifest window.
  const expected = clip.speedRamp ? null : clip.out - clip.in

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
    if (expected !== null) {
      const actual = Number(info.format.duration)
      check(
        Math.abs(actual - expected) < 0.5,
        `${clip.id}.${ext}: duration ${actual.toFixed(2)}s != ${expected.toFixed(2)}s`
      )
    }
  }

  const poster = join(POSTERS, `${clip.id}.webp`)
  check(existsSync(poster), `${clip.id}: missing poster at ${poster}`)
}

if (failures.length) {
  console.error('✗ verification failed:')
  for (const f of failures) console.error('  -', f)
  process.exit(1)
}
console.log(`✓ verified ${cfg.clips.length} clip(s)`)
