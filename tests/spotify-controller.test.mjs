import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'
import { createLoader } from './ts-loader.mjs'

const load = createLoader()
const { SpotifyController, playbackPosition } = load('../src/renderer/src/spotify/controller.ts')
const track = {
  id: 'track',
  uri: 'spotify:track:track',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  duration: 180
}
const device = {
  id: 'desktop',
  name: 'Spotify Desktop',
  isActive: true,
  restricted: false,
  supportsVolume: true,
  volume: 42
}

function harness(overrides = {}) {
  const calls = []
  let state = {
    track,
    device,
    contextUri: 'playlist',
    playing: true,
    positionMs: 3000,
    durationMs: 180000,
    shuffle: false,
    repeat: 'off',
    receivedAt: Date.now(),
    disallowed: {}
  }
  let sdkPlayer
  const api = {
    getAccessToken: async () => 'sdk-access-token',
    getDevices: async () => [device],
    getPlayback: async () => structuredClone({ ...state, receivedAt: Date.now() }),
    transfer: async (id) => {
      calls.push(['transfer', id])
      state = { ...state, device: { ...device, id } }
    },
    play: async (...args) => {
      calls.push(['play', ...args])
      state = { ...state, playing: true }
    },
    pause: async (id) => {
      calls.push(['pause', id])
      state = { ...state, playing: false }
    },
    next: async (id) => {
      calls.push(['next', id])
    },
    previous: async (id) => {
      calls.push(['previous', id])
    },
    seek: async (id, positionMs) => {
      calls.push(['seek', id, positionMs])
      state = { ...state, positionMs }
    },
    setVolume: async (id, volume) => {
      calls.push(['volume', id, volume])
      state = { ...state, device: { ...state.device, volume } }
    },
    setShuffle: async (id, shuffle) => {
      calls.push(['shuffle', id, shuffle])
      state = { ...state, shuffle }
    },
    setRepeat: async (id, repeat) => {
      calls.push(['repeat', id, repeat])
      state = { ...state, repeat }
    },
    ...overrides
  }
  class Player {
    listeners = new Map()
    constructor(options) {
      this.options = options
      // Keep the SDK instance available for emitting integration events.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      sdkPlayer = this
    }
    addListener(event, callback) {
      this.listeners.set(event, callback)
      return true
    }
    async connect() {
      this.emit('ready', { device_id: 'sdk-device' })
      return true
    }
    disconnect() {
      calls.push(['disconnect'])
    }
    async activateElement() {
      calls.push(['activate'])
    }
    async pause() {
      calls.push(['sdk-pause'])
    }
    async getCurrentState() {
      return null
    }
    emit(event, payload) {
      this.listeners.get(event)?.(payload)
    }
  }
  const controller = new SpotifyController(
    api,
    async () => ({ Player }),
    async () => {}
  )
  return {
    controller,
    api,
    calls,
    getPlayer: () => sdkPlayer,
    setState: (value) => {
      state = value
    }
  }
}

test('progress interpolates only real playback and clamps to duration', () => {
  const state = { playing: true, positionMs: 1000, durationMs: 3000, receivedAt: 100 }
  assert.equal(playbackPosition(state, 1100), 2000)
  assert.equal(playbackPosition(state, 9999), 3000)
  assert.equal(playbackPosition({ ...state, playing: false }, 9999), 1000)
  assert.equal(playbackPosition(null, 100), 0)
})

test('SDK ready registers the real device and obtains refreshed access tokens on demand', async (t) => {
  const { controller, getPlayer } = harness()
  t.after(() => controller.stop())
  await controller.start()
  await flush()
  const state = controller.getSnapshot()
  assert.equal(state.sdkStatus, 'ready')
  assert.equal(state.selectedDeviceId, 'sdk-device')
  assert.ok(state.devices.some((item) => item.id === 'sdk-device'))
  let token
  getPlayer().options.getOAuthToken((value) => {
    token = value
  })
  await flush()
  assert.equal(token, 'sdk-access-token')
})

test('SDK playback synchronizes current track, pause, seek, shuffle, repeat and artwork', async (t) => {
  const { controller, getPlayer } = harness()
  t.after(() => controller.stop())
  await controller.start()
  await flush()
  await controller.selectDevice('sdk-device')
  getPlayer().emit('player_state_changed', {
    paused: true,
    position: 12000,
    duration: 200000,
    shuffle: true,
    repeat_mode: 2,
    context: { uri: 'updated-playlist' },
    disallows: { seeking: true },
    track_window: {
      current_track: {
        id: 'sdk-track',
        uri: 'spotify:track:sdk-track',
        name: 'SDK Song',
        artists: [{ name: 'SDK Artist' }],
        album: { name: 'SDK Album', images: [{ url: 'https://i.scdn.co/image/sdk' }] }
      }
    }
  })
  const state = controller.getSnapshot().snapshot
  assert.equal(state.track.title, 'SDK Song')
  assert.equal(state.track.imageUrl, 'https://i.scdn.co/image/sdk')
  assert.equal(state.positionMs, 12000)
  assert.equal(state.playing, false)
  assert.equal(state.shuffle, true)
  assert.equal(state.repeat, 'track')
  assert.equal(state.disallowed.seeking, true)
})

test('Play activates browser audio synchronously before transferring and starting a playlist', async (t) => {
  const { controller, calls } = harness()
  t.after(() => controller.stop())
  await controller.start()
  await flush()
  await controller.selectDevice('sdk-device')
  calls.length = 0
  const promise = controller.play('spotify:playlist:playlist', 'spotify:track:track')
  assert.equal(calls[0][0], 'activate')
  await promise
  assert.ok(calls.some((call) => call[0] === 'play' && call[1] === 'sdk-device'))
})

test('playback commands wait for Spotify and never fake successful state on failure', async (t) => {
  const { controller } = harness({
    pause: async () => {
      throw new Error('Spotify rejected pause')
    }
  })
  t.after(() => controller.stop())
  await controller.start()
  await flush()
  await controller.selectDevice('desktop')
  assert.equal(controller.getSnapshot().snapshot.playing, true)
  await controller.pause()
  assert.equal(controller.getSnapshot().snapshot.playing, true)
  assert.match(controller.getSnapshot().error, /rejected pause/)
  assert.equal(controller.getSnapshot().busy, false)
})

test('controls synchronize volume, mute, shuffle on/off and repeat modes from confirmed state', async (t) => {
  const { controller, calls } = harness()
  t.after(() => controller.stop())
  await controller.start()
  await flush()
  await controller.selectDevice('desktop')
  await controller.volume(30)
  await controller.mute()
  assert.equal(controller.getSnapshot().snapshot.device.volume, 0)
  await controller.mute()
  assert.equal(controller.getSnapshot().snapshot.device.volume, 30)
  await controller.shuffle(true)
  assert.equal(controller.getSnapshot().snapshot.shuffle, true)
  await controller.shuffle(false)
  assert.equal(controller.getSnapshot().snapshot.shuffle, false)
  for (const mode of ['context', 'track', 'off']) {
    await controller.repeat(mode)
    assert.equal(controller.getSnapshot().snapshot.repeat, mode)
  }
  await controller.seek(12000)
  assert.ok(calls.some((call) => call[0] === 'seek' && call[2] === 12000))
})

test('SDK initialization errors do not silently select Spotify Desktop', async (t) => {
  const { controller, getPlayer, calls } = harness()
  t.after(() => controller.stop())
  await controller.start()
  await flush()
  getPlayer().emit('initialization_error', { message: 'EME unavailable' })
  assert.equal(controller.getSnapshot().sdkStatus, 'unavailable')
  assert.match(controller.getSnapshot().sdkError, /Widevine/)
  assert.equal(controller.getSnapshot().selectedDeviceId, '')
  await controller.play('playlist')
  assert.equal(
    calls.some((call) => call[0] === 'play'),
    false
  )
})

test('stopping during SDK loading prevents a late device from being created', async () => {
  let resolve
  let created = 0
  const { controller: original, api } = harness()
  original.stop()
  const controller = new SpotifyController(
    api,
    () =>
      new Promise((done) => {
        resolve = done
      }),
    async () => {}
  )
  const startup = controller.start()
  await flush()
  controller.stop()
  resolve({
    Player: class {
      constructor() {
        created++
      }
    }
  })
  await startup
  assert.equal(created, 0)
  assert.equal(controller.getSnapshot().sdkStatus, 'idle')
})

test('commands are serialized to preserve play/pause/navigation ordering', async (t) => {
  let release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  const { controller, calls } = harness({
    pause: async () => {
      calls.push(['pause-start'])
      await pending
      calls.push(['pause-end'])
    }
  })
  t.after(() => controller.stop())
  await controller.start()
  await flush()
  await controller.selectDevice('desktop')
  const pause = controller.pause()
  const next = controller.next()
  await flush()
  assert.equal(
    calls.some((call) => call[0] === 'next'),
    false
  )
  release()
  await Promise.all([pause, next])
  assert.ok(
    calls.findIndex((call) => call[0] === 'pause-end') <
      calls.findIndex((call) => call[0] === 'next')
  )
})

test('an active Spotify Desktop cannot override the local audio target during polling', async (t) => {
  const { controller, calls } = harness()
  t.after(() => controller.stop())
  await controller.start()
  await flush()
  await controller.poll(true)
  assert.equal(controller.getSnapshot().snapshot.device.id, 'desktop')
  assert.equal(controller.getSnapshot().selectedDeviceId, 'sdk-device')
  await controller.play('spotify:playlist:configured')
  assert.ok(calls.some((call) => call[0] === 'transfer' && call[1] === 'sdk-device'))
  assert.ok(calls.some((call) => call[0] === 'play' && call[1] === 'sdk-device'))
})

test('the local player is selected with no other Spotify devices online', async (t) => {
  const { controller } = harness({ getDevices: async () => [], getPlayback: async () => null })
  t.after(() => controller.stop())
  await controller.start()
  await flush()
  assert.equal(controller.getSnapshot().selectedDeviceId, 'sdk-device')
  assert.equal(controller.getSnapshot().devices[0].id, 'sdk-device')
})

test('missing DRM reports the local blocker and never selects a remote fallback', async (t) => {
  const { api } = harness()
  const controller = new SpotifyController(
    api,
    async () => {
      assert.fail('Do not create a player without DRM')
    },
    async () => {
      throw new Error('Widevine unavailable')
    }
  )
  t.after(() => controller.stop())
  await controller.start()
  await flush()
  assert.equal(controller.getSnapshot().sdkStatus, 'unavailable')
  assert.match(controller.getSnapshot().sdkError, /Widevine unavailable/)
  assert.equal(controller.getSnapshot().selectedDeviceId, '')
})

test('a playback failure pauses and disconnects once, preserving the error against stale state', async (t) => {
  const { controller, getPlayer, calls } = harness()
  t.after(() => controller.stop())
  await controller.start()
  await flush()
  getPlayer().emit('playback_error', { message: 'Widevine license failed' })
  getPlayer().emit('playback_error', { message: 'duplicate failure' })
  await flush()
  assert.match(controller.getSnapshot().sdkError, /Widevine license failed/)
  assert.equal(controller.getSnapshot().sdkStatus, 'unavailable')
  assert.equal(controller.getSnapshot().selectedDeviceId, '')
  assert.equal(calls.filter((call) => call[0] === 'sdk-pause').length, 1)
  assert.equal(calls.filter((call) => call[0] === 'disconnect').length, 1)
  await controller.poll(true)
  getPlayer().emit('ready', { device_id: 'late-device' })
  assert.match(controller.getSnapshot().sdkError, /Widevine license failed/)
  assert.equal(controller.getSnapshot().selectedDeviceId, '')
})
