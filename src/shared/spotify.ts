export interface SpotifyTrack {
  id: string
  uri: string
  title: string
  artist: string
  album: string
  duration: number
  imageUrl?: string
  externalUrl: string
}

export interface SpotifyPlaylist {
  id: string
  uri: string
  name: string
  description: string
  owner: string
  externalUrl: string
  tracks: SpotifyTrack[]
}

export interface SpotifyDevice {
  id: string
  name: string
  isActive: boolean
  restricted: boolean
  supportsVolume: boolean
  volume: number | null
}

export interface SpotifySession {
  connected: boolean
  clientId: string
  redirectUri: string
  persistent: boolean
}

export type RepeatMode = 'off' | 'context' | 'track'

export interface SpotifyPlayback {
  device: SpotifyDevice | null
  track: SpotifyTrack | null
  contextUri: string | null
  playing: boolean
  positionMs: number
  durationMs: number
  shuffle: boolean
  repeat: RepeatMode
  receivedAt: number
  disallowed: Record<string, boolean>
}

export interface SpotifyAPI {
  getSession: () => Promise<SpotifySession>
  login: (clientId: string) => Promise<SpotifySession>
  logout: () => Promise<void>
  getAccessToken: () => Promise<string>
  importPlaylist: (input: string) => Promise<SpotifyPlaylist>
  getDevices: () => Promise<SpotifyDevice[]>
  getPlayback: () => Promise<SpotifyPlayback | null>
  transfer: (deviceId: string) => Promise<void>
  play: (deviceId: string, playlistUri?: string, trackUri?: string) => Promise<void>
  pause: (deviceId: string) => Promise<void>
  next: (deviceId: string) => Promise<void>
  previous: (deviceId: string) => Promise<void>
  seek: (deviceId: string, positionMs: number) => Promise<void>
  setVolume: (deviceId: string, volume: number) => Promise<void>
  setShuffle: (deviceId: string, enabled: boolean) => Promise<void>
  setRepeat: (deviceId: string, mode: RepeatMode) => Promise<void>
  openSpotify: (uri: string) => Promise<void>
}

export const SPOTIFY_CHANNELS = {
  getSession: 'spotify:session',
  login: 'spotify:login',
  logout: 'spotify:logout',
  getAccessToken: 'spotify:sdk-token',
  importPlaylist: 'spotify:import-playlist',
  getDevices: 'spotify:devices',
  getPlayback: 'spotify:playback',
  transfer: 'spotify:transfer',
  play: 'spotify:play',
  pause: 'spotify:pause',
  next: 'spotify:next',
  previous: 'spotify:previous',
  seek: 'spotify:seek',
  setVolume: 'spotify:volume',
  setShuffle: 'spotify:shuffle',
  setRepeat: 'spotify:repeat',
  openSpotify: 'spotify:open'
} as const
