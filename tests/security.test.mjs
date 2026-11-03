import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
const { assertTrustedIpcSender, isAllowedExternalUrl, isTrustedRendererUrl } =
  loadTypeScript('../src/main/security.ts')
const { IPC_CHANNELS } = loadTypeScript('../src/shared/api.ts')
const { SPOTIFY_CHANNELS } = loadTypeScript('../src/shared/spotify.ts')

function loadTypeScript(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    URL,
    require: (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`)
      return dependencies[name]
    }
  })
  return exports
}

const rendererUrl = 'file:///app/renderer/index.html'

function createSender(url = rendererUrl) {
  const mainFrame = { url }
  const contents = { mainFrame, isDestroyed: () => false }
  return { contents, event: { sender: contents, senderFrame: mainFrame } }
}

test('only the exact renderer document and its hash routes are trusted', () => {
  for (const url of [rendererUrl, `${rendererUrl}#/library`]) {
    assert.equal(isTrustedRendererUrl(url, rendererUrl), true)
  }
  for (const url of [
    'file:///app/renderer/other.html',
    `${rendererUrl}?injected=1`,
    'https://attacker.example',
    'about:blank',
    'invalid url'
  ]) {
    assert.equal(isTrustedRendererUrl(url, rendererUrl), false)
  }
})

test('development trust does not extend to other ports, hosts or documents', () => {
  const devUrl = 'http://localhost:5173/'
  assert.equal(isTrustedRendererUrl(`${devUrl}#route`, devUrl), true)
  for (const url of [
    'http://localhost:5174/',
    'http://localhost:5173/other',
    'http://localhost.attacker.example:5173/'
  ]) {
    assert.equal(isTrustedRendererUrl(url, devUrl), false)
  }
})

test('IPC accepts the trusted window main frame', () => {
  const { contents, event } = createSender()
  assert.doesNotThrow(() => assertTrustedIpcSender(event, contents, rendererUrl))
})

test('IPC rejects foreign windows, subframes and missing frames', () => {
  const { contents, event } = createSender()
  for (const untrusted of [
    { ...event, sender: createSender().contents },
    { ...event, senderFrame: { url: rendererUrl } },
    { ...event, senderFrame: null }
  ]) {
    assert.throws(() => assertTrustedIpcSender(untrusted, contents, rendererUrl), /Untrusted/)
  }
})

test('IPC rejects navigated, destroyed and closed windows', () => {
  const navigated = createSender('https://attacker.example')
  assert.throws(
    () => assertTrustedIpcSender(navigated.event, navigated.contents, rendererUrl),
    /Untrusted/
  )
  const { contents, event } = createSender()
  contents.isDestroyed = () => true
  assert.throws(() => assertTrustedIpcSender(event, contents, rendererUrl), /Untrusted/)
  assert.throws(() => assertTrustedIpcSender(event, undefined, rendererUrl), /Untrusted/)
})

test('external links require an explicitly allowed HTTPS host', () => {
  assert.equal(isAllowedExternalUrl('https://electron-vite.org/guide/'), true)
  for (const url of [
    'http://electron-vite.org/',
    'https://electron-vite.org.attacker.example/',
    'https://electron-vite.org@attacker.example/',
    'https://user:password@electron-vite.org/',
    'https://electron-vite.org:8443/',
    'file:///tmp/executable',
    'javascript:alert(1)',
    'spotify:track:123',
    'invalid url'
  ]) {
    assert.equal(isAllowedExternalUrl(url), false, url)
  }
})

test('preload exposes only fixed operations and does not forward renderer arguments', async () => {
  const exposed = new Map()
  const calls = []
  loadTypeScript('../src/preload/index.ts', {
    '../shared/api': { IPC_CHANNELS },
    '../shared/spotify': { SPOTIFY_CHANNELS },
    electron: {
      contextBridge: { exposeInMainWorld: (key, value) => exposed.set(key, value) },
      ipcRenderer: {
        invoke: async (...args) => {
          calls.push(args)
          return args[0] === IPC_CHANNELS.ping ? 'pong' : { electron: 'test' }
        }
      }
    }
  })
  assert.deepEqual([...exposed.keys()], ['api'])
  const api = exposed.get('api')
  assert.deepEqual(Object.keys(api).sort(), [
    'close',
    'getVersions',
    'minimize',
    'ping',
    'spotify',
    'toggleMaximize'
  ])
  assert.equal(await api.ping('arbitrary:channel', { malicious: true }), 'pong')
  await api.getVersions('arbitrary:channel')
  await api.minimize('arbitrary:channel')
  await api.toggleMaximize('arbitrary:channel')
  await api.close('arbitrary:channel')
  assert.deepEqual(Object.keys(api.spotify).sort(), Object.keys(SPOTIFY_CHANNELS).sort())
  assert.deepEqual(calls, [
    [IPC_CHANNELS.ping],
    [IPC_CHANNELS.getVersions],
    [IPC_CHANNELS.minimize],
    [IPC_CHANNELS.toggleMaximize],
    [IPC_CHANNELS.close]
  ])
  calls.length = 0
  await api.spotify.getAccessToken('not-an-allowed-channel')
  await api.spotify.play('device', 'spotify:playlist:allowed', 'spotify:track:allowed')
  await api.spotify.setVolume('device', 42)
  assert.deepEqual(calls, [
    [SPOTIFY_CHANNELS.getAccessToken],
    [SPOTIFY_CHANNELS.play, 'device', 'spotify:playlist:allowed', 'spotify:track:allowed'],
    [SPOTIFY_CHANNELS.setVolume, 'device', 42]
  ])
})
