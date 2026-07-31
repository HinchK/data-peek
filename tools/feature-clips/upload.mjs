#!/usr/bin/env node
import { readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './lib/ffmpeg.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, 'dist')

/**
 * Credentials come from the environment ONLY — never a file in this repo,
 * never a CLI argument (which leaks into shell history and process listings),
 * never hardcoded. CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required
 * even though `wrangler login` can authenticate interactively instead: a dev
 * machine can already have an unrelated wrangler OAuth session active for a
 * different Cloudflare account (this is not hypothetical — verified present
 * on the machine this script was written on), and silently reusing it here
 * would upload to the wrong place with no warning. Requiring explicit env
 * vars makes every run's credential scope deliberate.
 */
const REQUIRED_ENV = ['R2_BUCKET', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']
const missing = REQUIRED_ENV.filter((name) => !process.env[name])

if (missing.length > 0) {
  console.error(
    `Missing required environment variable(s): ${missing.join(', ')}\n\n` +
      'Supply them with 1Password injection (recommended — the values only ever\n' +
      'reach this process, never your shell history):\n' +
      '  op run -- node upload.mjs\n\n' +
      'Or export them yourself for this shell session only:\n' +
      '  export R2_BUCKET=<bucket-name>\n' +
      '  export CLOUDFLARE_API_TOKEN=<token>\n' +
      '  export CLOUDFLARE_ACCOUNT_ID=<account-id>\n' +
      '  node upload.mjs\n\n' +
      "Don't want to manage a token? Run `npx wrangler login` to authenticate\n" +
      'interactively, then upload each file with the wrangler CLI directly instead\n' +
      'of this script:\n' +
      '  npx wrangler r2 object put <bucket>/clips/<file> --file dist/<file> --remote'
  )
  process.exit(1)
}

if (!existsSync(DIST)) {
  console.error(`Nothing to upload: ${DIST} does not exist. Run \`node encode.mjs\` first.`)
  process.exit(1)
}

const files = readdirSync(DIST).filter((f) => /\.(mp4|webm|gif)$/.test(f))
if (files.length === 0) {
  console.error(`No encoded assets in ${DIST}. Run \`node encode.mjs\` first.`)
  process.exit(1)
}

const BUCKET = process.env.R2_BUCKET
const CONTENT_TYPE = { mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif' }

for (const file of files) {
  const ext = file.split('.').pop()
  console.log(`▶ ${file}`)
  // CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are read by wrangler itself from
  // the inherited environment — never passed as a flag, so they never appear in
  // this process's argv (visible to `ps`) or in any log line here.
  await run('npx', [
    '--yes',
    'wrangler',
    'r2',
    'object',
    'put',
    `${BUCKET}/clips/${file}`,
    '--file',
    join(DIST, file),
    '--content-type',
    CONTENT_TYPE[ext],
    '--cache-control',
    'public, max-age=31536000, immutable',
    '--remote'
  ])
}

console.log(`\n✓ uploaded ${files.length} file(s) to ${BUCKET}/clips/`)
