import type {
  RepeatMode,
  SpotifyDevice,
  SpotifyPlayback,
  SpotifyPlaylist,
  SpotifyTrack
} from '../../shared/spotify'
import { boundedNumber, deviceId, playlistId, spotifyUri } from './validation'

interface RawTrack {
  id?: string
  uri?: string
  type?: string
  name?: string
  duration_ms?: number
  is_local?: boolean
  is_playable?: boolean
  artists?: { name?: string }[]
  album?: { name?: string; images?: { url?: string }[] }
  external_urls?: { spotify?: string }
}
interface RawDevice {
  id?: string
  name?: string
  is_active?: boolean
  is_restricted?: boolean
  supports_volume?: boolean
  volume_percent?: number | null
}
interface RawPlayback {
  device?: RawDevice
  item?: RawTrack
  context?: { uri?: string }
  is_playing?: boolean
  progress_ms?: number
  shuffle_state?: boolean
  repeat_state?: RepeatMode
  actions?: { disallows?: Record<string, boolean> }
}
interface PlaylistPage {
  items?: { track?: RawTrack | null; item?: RawTrack | null; is_local?: boolean }[]
  next?: string | null
  total?: number
}
interface RawPlaylist {
  id?: string
  name?: string
  description?: string
  owner?: { display_name?: string }
  external_urls?: { spotify?: string }
}

export function normalizeTrack(track: RawTrack | null | undefined): SpotifyTrack | null {
  if (
    !track?.id ||
    track.type !== 'track' ||
    track.is_local ||
    track.is_playable === false ||
    !track.uri?.startsWith('spotify:track:')
  )
    return null
  const candidate = track.album?.images?.[0]?.url
  const imageUrl =
    candidate && /^https:\/\/[^/]+\.scdn\.co\//.test(candidate) ? candidate : undefined
  return {
    id: track.id,
    uri: track.uri,
    title: track.name ?? 'Unknown track',
    artist:
      track.artists?.map((artist) => artist.name ?? 'Unknown artist').join(', ') ||
      'Unknown artist',
    album: track.album?.name ?? '',
    duration: Math.max(0, track.duration_ms ?? 0) / 1000,
    imageUrl,
    externalUrl: `https://open.spotify.com/track/${track.id}`
  }
}

export function normalizeDevice(device: RawDevice): SpotifyDevice | null {
  if (!device.id) return null
  return {
    id: device.id,
    name: device.name ?? 'Spotify device',
    isActive: !!device.is_active,
    restricted: !!device.is_restricted,
    supportsVolume: device.supports_volume !== false && device.volume_percent != null,
    volume: device.volume_percent ?? null
  }
}

export function normalizePlayback(playback: RawPlayback, now = Date.now()): SpotifyPlayback {
  return {
    device: playback.device ? normalizeDevice(playback.device) : null,
    track: normalizeTrack(playback.item),
    contextUri: playback.context?.uri ?? null,
    playing: !!playback.is_playing,
    positionMs: Math.max(0, playback.progress_ms ?? 0),
    durationMs: Math.max(0, playback.item?.duration_ms ?? 0),
    shuffle: !!playback.shuffle_state,
    repeat: ['off', 'track', 'context'].includes(playback.repeat_state ?? '')
      ? playback.repeat_state!
      : 'off',
    receivedAt: now,
    disallowed: playback.actions?.disallows ?? {}
  }
}

export class SpotifyService {
  private retryAt = 0
  constructor(
    private readonly auth: { token: (force?: boolean) => Promise<string> },
    private readonly fetcher: typeof fetch = fetch
  ) {}

  private async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    retry = true
  ): Promise<T | null> {
    if (Date.now() < this.retryAt)
      throw new Error(
        `Spotify is rate limiting requests. Try again in ${Math.ceil((this.retryAt - Date.now()) / 1000)} seconds.`
      )
    const token = await this.auth.token()
    const response = await this.fetcher(`https://api.spotify.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15000)
    })
    if (response.status === 401 && retry) {
      await this.auth.token(true)
      return this.request<T>(path, method, body, false)
    }
    if (response.status === 429) {
      const seconds = Math.min(3600, Math.max(1, Number(response.headers.get('retry-after')) || 5))
      this.retryAt = Date.now() + seconds * 1000
      throw new Error(`Spotify is rate limiting requests. Try again in ${seconds} seconds.`)
    }
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: 'Your Spotify session expired. Disconnect and sign in again.',
        403: 'Spotify denied this request. Check Premium, app user access, and playlist ownership or collaboration permissions.',
        404: 'Spotify could not find the playlist or active device. Refresh devices and try again.'
      }
      throw Object.assign(
        new Error(
          messages[response.status] ??
            `Spotify request failed (${response.status}). Please try again.`
        ),
        { status: response.status }
      )
    }
    // Playback commands only acknowledge success. Some Spotify responses contain
    // an opaque text acknowledgement (or an empty body), rather than JSON.
    if (response.status === 204 || method !== 'GET') {
      await response.body?.cancel().catch(() => {})
      return null
    }
    try {
      return (await response.json()) as T
    } catch {
      // Never expose response fragments, which may contain sensitive values, via IPC.
      throw new Error('Spotify returned an invalid JSON response. Please try again.')
    }
  }

  async importPlaylist(input: unknown): Promise<SpotifyPlaylist> {
    const id = playlistId(input)
    const playlist = await this.request<RawPlaylist>(`/playlists/${id}`)
    if (!playlist) throw new Error('Spotify returned an empty playlist response.')
    const tracks: SpotifyTrack[] = []
    let endpoint = 'items'
    for (let offset = 0; offset < 10000; offset += 50) {
      let page: PlaylistPage | null
      try {
        page = await this.request<PlaylistPage>(
          `/playlists/${id}/${endpoint}?limit=50&offset=${offset}`
        )
      } catch (error) {
        if (offset !== 0 || endpoint !== 'items' || (error as { status?: number }).status !== 404)
          throw error
        endpoint = 'tracks'
        page = await this.request<PlaylistPage>(`/playlists/${id}/tracks?limit=50&offset=0`)
      }
      for (const entry of page?.items ?? []) {
        const track = entry.is_local ? null : normalizeTrack(entry.item ?? entry.track)
        if (track) tracks.push(track)
      }
      if (!page?.next || !page.items?.length) break
    }
    return {
      id,
      uri: `spotify:playlist:${id}`,
      name: playlist.name ?? 'Spotify playlist',
      description: playlist.description ?? '',
      owner: playlist.owner?.display_name ?? 'Spotify',
      externalUrl: `https://open.spotify.com/playlist/${id}`,
      tracks
    }
  }

  async devices(): Promise<SpotifyDevice[]> {
    const result = await this.request<{ devices: RawDevice[] }>('/me/player/devices')
    return (result?.devices ?? [])
      .map(normalizeDevice)
      .filter((device): device is SpotifyDevice => device !== null)
  }

  async playback(): Promise<SpotifyPlayback | null> {
    const result = await this.request<RawPlayback>('/me/player')
    return result ? normalizePlayback(result) : null
  }

  async transfer(id: unknown): Promise<void> {
    await this.request('/me/player', 'PUT', { device_ids: [deviceId(id)], play: false })
  }

  async play(id: unknown, playlist?: unknown, track?: unknown): Promise<void> {
    const body =
      playlist === undefined
        ? undefined
        : {
            context_uri: spotifyUri(playlist, 'playlist'),
            ...(track === undefined ? {} : { offset: { uri: spotifyUri(track, 'track') } })
          }
    if (track !== undefined && playlist === undefined) throw new Error('Select a playlist first.')
    await this.request(`/me/player/play?device_id=${deviceId(id)}`, 'PUT', body)
  }

  async pause(id: unknown): Promise<void> {
    await this.request(`/me/player/pause?device_id=${deviceId(id)}`, 'PUT')
  }
  async next(id: unknown): Promise<void> {
    await this.request(`/me/player/next?device_id=${deviceId(id)}`, 'POST')
  }
  async previous(id: unknown): Promise<void> {
    await this.request(`/me/player/previous?device_id=${deviceId(id)}`, 'POST')
  }
  async seek(id: unknown, position: unknown): Promise<void> {
    await this.request(
      `/me/player/seek?device_id=${deviceId(id)}&position_ms=${boundedNumber(position, 0, 86400000)}`,
      'PUT'
    )
  }
  async volume(id: unknown, value: unknown): Promise<void> {
    await this.request(
      `/me/player/volume?device_id=${deviceId(id)}&volume_percent=${boundedNumber(value, 0, 100)}`,
      'PUT'
    )
  }
  async shuffle(id: unknown, value: unknown): Promise<void> {
    if (typeof value !== 'boolean') throw new Error('Invalid shuffle state')
    await this.request(`/me/player/shuffle?device_id=${deviceId(id)}&state=${value}`, 'PUT')
  }
  async repeat(id: unknown, mode: unknown): Promise<void> {
    if (mode !== 'off' && mode !== 'context' && mode !== 'track')
      throw new Error('Invalid repeat mode')
    await this.request(`/me/player/repeat?device_id=${deviceId(id)}&state=${mode}`, 'PUT')
  }
}
