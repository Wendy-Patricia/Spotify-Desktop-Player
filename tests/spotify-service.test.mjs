import assert from 'node:assert/strict'
import test from 'node:test'
import { createLoader } from './ts-loader.mjs'

const load = createLoader()
const { SpotifyService, normalizePlayback } = load('../src/main/spotify/service.ts')
const { playlistId, boundedNumber } = load('../src/main/spotify/validation.ts')
const { isSpotifySdkUrl, isAllowedMediaOrigin } = load('../src/main/security.ts')
const id = '0123456789ABCDEFGHIJKL'
const rawTrack = {
  id,
  uri: `spotify:track:${id}`,
  type: 'track',
  name: 'Real song',
  artists: [{ name: 'Real artist' }],
  album: { name: 'Real album', images: [{ url: 'https://i.scdn.co/image/cover' }] },
  duration_ms: 180000
}
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers })

test('playlist import accepts Spotify IDs, URIs, and official URLs only', () => {
  for (const input of [
    id,
    `spotify:playlist:${id}`,
    `https://open.spotify.com/playlist/${id}?si=abc`,
    `https://open.spotify.com/intl-en/playlist/${id}`
  ])
    assert.equal(playlistId(input), id)
  for (const input of [
    `https://open.spotify.com.evil.test/playlist/${id}`,
    `https://open.spotify.com:8888/playlist/${id}`,
    `file:///playlist/${id}`,
    `spotify:track:${id}`,
    { id },
    '../secrets'
  ])
    assert.throws(() => playlistId(input))
})

test('only the official SDK frame and trusted origins receive DRM access', () => {
  assert.equal(isSpotifySdkUrl('https://sdk.scdn.co/embedded/index.html?x=1'), true)
  assert.equal(isSpotifySdkUrl('https://sdk.scdn.co.evil.test/embedded/index.html'), false)
  assert.equal(isSpotifySdkUrl('https://sdk.scdn.co/other.html'), false)
  assert.equal(isAllowedMediaOrigin('pastel://player', 'pastel://player/index.html'), true)
  assert.equal(isAllowedMediaOrigin('https://sdk.scdn.co', 'pastel://player/index.html'), true)
  assert.equal(isAllowedMediaOrigin('https://evil.test', 'pastel://player/index.html'), false)
  assert.equal(isAllowedMediaOrigin('file:///other.html', 'file:///index.html'), false)
})

test('playlist pagination handles 2026 item fields and skips unavailable content', async () => {
  const urls = []
  const service = new SpotifyService({ token: async () => 'token' }, async (url) => {
    urls.push(url)
    if (!url.includes('/items?'))
      return json({ name: 'Imported playlist', owner: { display_name: 'Listener' } })
    if (url.endsWith('offset=0'))
      return json({
        items: [
          { item: rawTrack },
          { item: null },
          { item: { ...rawTrack, type: 'episode' } },
          { item: { ...rawTrack, is_local: true } }
        ],
        next: 'https://untrusted.example/pagination'
      })
    return json({ items: [{ item: { ...rawTrack, id: 'second' } }], next: null })
  })
  const playlist = await service.importPlaylist(id)
  assert.equal(playlist.tracks.length, 2)
  assert.equal(playlist.tracks[0].title, 'Real song')
  assert.equal(playlist.tracks[0].imageUrl, 'https://i.scdn.co/image/cover')
  assert.ok(urls.every((url) => url.startsWith('https://api.spotify.com/v1/')))
  assert.ok(urls[2].endsWith('offset=50'))
})

test('legacy playlist endpoints are used only after a 404 for the new endpoint', async () => {
  const urls = []
  const service = new SpotifyService({ token: async () => 'token' }, async (url) => {
    urls.push(url)
    if (url.includes('/items?')) return json({}, 404)
    if (url.includes('/tracks?')) return json({ items: [{ track: rawTrack }], next: null })
    return json({ name: 'Legacy playlist' })
  })
  assert.equal((await service.importPlaylist(id)).tracks.length, 1)
  assert.equal(urls.length, 3)
})

test('all playback controls send device-scoped Spotify requests', async () => {
  const calls = []
  const service = new SpotifyService({ token: async () => 'access' }, async (url, options) => {
    calls.push({ url, ...options })
    return new Response(null, { status: 204 })
  })
  await service.transfer('device')
  await service.play('device', `spotify:playlist:${id}`, `spotify:track:${id}`)
  await service.pause('device')
  await service.next('device')
  await service.previous('device')
  await service.seek('device', 45000)
  await service.volume('device', 25)
  await service.shuffle('device', true)
  await service.shuffle('device', false)
  await service.repeat('device', 'track')
  await service.repeat('device', 'context')
  await service.repeat('device', 'off')
  assert.deepEqual(JSON.parse(calls[0].body), { device_ids: ['device'], play: false })
  assert.deepEqual(JSON.parse(calls[1].body), {
    context_uri: `spotify:playlist:${id}`,
    offset: { uri: `spotify:track:${id}` }
  })
  assert.ok(calls.slice(1).every((call) => call.url.includes('device_id=device')))
  assert.ok(calls.some((call) => call.url.includes('position_ms=45000')))
  assert.ok(calls.some((call) => call.url.includes('volume_percent=25')))
  assert.ok(calls.some((call) => call.url.includes('shuffle?device_id=device&state=false')))
  assert.ok(calls.every((call) => call.headers.Authorization === 'Bearer access'))
})

test('successful controls accept text acknowledgements and empty bodies without parsing JSON', async () => {
  for (const reply of [
    { status: 200, body: 'opaque-command-acknowledgement', type: 'text/plain' },
    { status: 200, body: '', type: 'application/json' },
    { status: 200, body: 'opaque-command-acknowledgement', type: 'application/json' },
    { status: 202, body: 'Accepted', type: 'text/plain' }
  ]) {
    let calls = 0
    const service = new SpotifyService({ token: async () => 'access' }, async () => {
      calls++
      return new Response(reply.body, {
        status: reply.status,
        headers: { 'content-type': reply.type }
      })
    })
    await service.transfer('device')
    await service.play('device', `spotify:playlist:${id}`)
    await service.pause('device')
    await service.next('device')
    await service.previous('device')
    await service.seek('device', 5000)
    await service.volume('device', 50)
    await service.shuffle('device', false)
    await service.repeat('device', 'off')
    assert.equal(calls, 9)
  }
})

test('failed controls still reject non-JSON HTTP error responses', async () => {
  const service = new SpotifyService(
    { token: async () => 'access' },
    async () => new Response('opaque-error-body', { status: 403 })
  )
  await assert.rejects(() => service.pause('device'), /Spotify denied this request/)
})

test('GET responses still require JSON without leaking their body in parse errors', async () => {
  const service = new SpotifyService(
    { token: async () => 'access' },
    async () => new Response('private-response-fragment', { status: 200 })
  )
  await assert.rejects(
    () => service.playback(),
    (error) => {
      assert.match(error.message, /invalid JSON response/)
      assert.equal(error.message.includes('private-response-fragment'), false)
      return true
    }
  )
})

test('invalid IPC arguments cannot reach Spotify', async () => {
  const service = new SpotifyService({
    token: async () => {
      assert.fail('must validate before fetching')
    }
  })
  for (const command of [
    () => service.seek('device', NaN),
    () => service.volume('device', 101),
    () => service.shuffle('device', 'true'),
    () => service.repeat('device', 'all'),
    () => service.play('device', 'spotify:playlist:invalid'),
    () => service.pause('device&injected=1')
  ])
    await assert.rejects(command)
  assert.throws(() => boundedNumber(Infinity, 0, 100))
})

test('401 refreshes the token once and 204 means no playback', async () => {
  const refreshes = []
  let attempts = 0
  const service = new SpotifyService(
    {
      token: async (force) => {
        refreshes.push(force)
        return 'token'
      }
    },
    async () => (++attempts === 1 ? json({}, 401) : new Response(null, { status: 204 }))
  )
  assert.equal(await service.playback(), null)
  assert.equal(refreshes.filter(Boolean).length, 1)
  assert.equal(attempts, 2)
})

test('rate limits back off without immediately repeating a command', async () => {
  let calls = 0
  const service = new SpotifyService({ token: async () => 'token' }, async () => {
    calls++
    return json({}, 429, { 'retry-after': '30' })
  })
  await assert.rejects(() => service.pause('device'), /30 seconds/)
  await assert.rejects(() => service.next('device'), /rate limiting/)
  assert.equal(calls, 1)
})

test('playback metadata, progress, shuffle, repeat, and restrictions come from Spotify', () => {
  const state = normalizePlayback(
    {
      item: rawTrack,
      device: { id: 'device', name: 'Desktop', is_active: true, volume_percent: 42 },
      progress_ms: 12345,
      is_playing: true,
      shuffle_state: true,
      repeat_state: 'track',
      actions: { disallows: { seeking: true } }
    },
    1000
  )
  assert.equal(state.track.artist, 'Real artist')
  assert.equal(state.positionMs, 12345)
  assert.equal(state.device.volume, 42)
  assert.equal(state.shuffle, true)
  assert.equal(state.repeat, 'track')
  assert.equal(state.disallowed.seeking, true)
})
