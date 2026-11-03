import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const python =
  process.env.SPOTIFY_PYTHON ||
  join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const commands = {
  verify: ['castlabs_evs.vmp', '--no-ask', 'verify-pkg', 'node_modules/electron/dist'],
  signup: ['castlabs_evs.account', 'signup'],
  login: ['castlabs_evs.account', 'reauth'],
  sign: ['castlabs_evs.vmp', 'sign-pkg', 'node_modules/electron/dist']
}
const command = commands[process.argv[2]]
if (!command) {
  console.error('Usage: node scripts/drm.mjs verify|signup|login|sign')
  process.exit(1)
}
if (!existsSync(python)) {
  console.error('Create the local Python environment first: python -m venv .venv')
  console.error("Then install scripts/requirements-drm.txt with that environment's pip.")
  process.exit(1)
}
const result = spawnSync(python, ['-m', ...command], { cwd: root, stdio: 'inherit', shell: false })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
