export interface SdkTrack {
  id: string
  uri: string
  name: string
  duration_ms: number
  artists: { name: string }[]
  album: { name: string; images: { url: string }[] }
}
export interface SdkState {
  context?: { uri?: string }
  shuffle?: boolean
  repeat_mode?: number
  paused: boolean
  position: number
  duration: number
  track_window: { current_track: SdkTrack }
  disallows?: Record<string, boolean>
}
export interface SdkEvents {
  ready: { device_id: string }
  not_ready: { device_id: string }
  player_state_changed: SdkState | null
  initialization_error: { message: string }
  authentication_error: { message: string }
  account_error: { message: string }
  playback_error: { message: string }
  autoplay_failed: Record<string, never>
}
export interface SdkPlayer {
  addListener: <K extends keyof SdkEvents>(
    event: K,
    callback: (data: SdkEvents[K]) => void
  ) => boolean
  connect: () => Promise<boolean>
  disconnect: () => void
  activateElement: () => Promise<void>
  pause: () => Promise<void>
  getCurrentState: () => Promise<SdkState | null>
}
export interface SdkNamespace {
  Player: new (options: {
    name: string
    getOAuthToken: (callback: (token: string) => void) => void
    volume: number
  }) => SdkPlayer
}

declare global {
  interface Window {
    Spotify?: SdkNamespace
    onSpotifyWebPlaybackSDKReady?: () => void
  }
}

let loading: Promise<SdkNamespace> | null = null

export async function assertWidevineSupport(): Promise<void> {
  try {
    if (!navigator.requestMediaKeySystemAccess) throw new Error('EME unavailable')
    await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [
      {
        initDataTypes: ['cenc'],
        audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }]
      },
      { initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/webm; codecs="opus"' }] }
    ])
  } catch {
    throw new Error(
      'Local Spotify audio is unavailable: Widevine DRM could not be initialized. Use the Castlabs runtime and complete its VMP signing setup. Opening Spotify Desktop is not required by this app.'
    )
  }
}

export function loadSpotifySdk(): Promise<SdkNamespace> {
  if (window.Spotify) return Promise.resolve(window.Spotify)
  if (loading) return loading
  loading = new Promise<SdkNamespace>((resolve, reject) => {
    const script = document.createElement('script')
    const timeout = window.setTimeout(() => fail(), 20000)
    const fail = (): void => {
      window.clearTimeout(timeout)
      script.remove()
      delete window.onSpotifyWebPlaybackSDKReady
      reject(new Error('Unable to load the Spotify player. Check your connection and try again.'))
    }
    window.onSpotifyWebPlaybackSDKReady = () => {
      window.clearTimeout(timeout)
      if (window.Spotify) resolve(window.Spotify)
      else fail()
    }
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.async = true
    script.onerror = fail
    document.head.appendChild(script)
  }).catch((error) => {
    loading = null
    throw error
  })
  return loading
}
