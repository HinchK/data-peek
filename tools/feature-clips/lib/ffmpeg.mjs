import { spawn } from 'node:child_process'

/** Run a command, capturing stderr, and reject on a non-zero exit. */
export function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', (err) =>
      reject(new Error(`${cmd} failed to spawn: ${err.message}. Is it installed?`))
    )
    child.on('close', (code) => {
      if (code === 0) return resolve()
      reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-2000)}`))
    })
  })
}

/** ffprobe a file and return its parsed JSON (format + streams). */
export function probe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      file
    ])
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => {
      out += d.toString()
    })
    child.stderr.on('data', (d) => {
      err += d.toString()
    })
    child.on('error', (e) => reject(new Error(`ffprobe failed to spawn: ${e.message}`)))
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe ${file} exited ${code}\n${err}`))
      resolve(JSON.parse(out))
    })
  })
}
