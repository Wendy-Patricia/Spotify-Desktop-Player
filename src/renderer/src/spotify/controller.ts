import type {
  RepeatMode,
  SpotifyAPI,
  SpotifyDevice,
  SpotifyPlayback
} from '../../../shared/spotify'
import { loadSpotifySdk, assertWidevineSupport } from './sdk'
import type { SdkNamespace, SdkPlayer, SdkState } from './sdk'

export interface PlaybackStore {
  snapshot: SpotifyPlayback | null
  devices: SpotifyDevice[]
  selectedDeviceId: string
  sdkStatus: 'idle' | 'connecting' | 'ready' | 'unavailable'
  sdkError: string
  error: string
  busy: boolean
}

export function playbackPosition(snapshot: SpotifyPlayback | null, now = Date.now()): number {
  if (!snapshot) return 0
  const elapsed = snapshot.playing ? Math.max(0, now - snapshot.receivedAt) : 0
  return Math.min(snapshot.durationMs, Math.max(0, snapshot.positionMs + elapsed))
}

export class SpotifyController {
  private store: PlaybackStore = {
    snapshot: null,
    devices: [],
    selectedDeviceId: '',
    sdkStatus: 'idle',
    sdkError: '',
    error: '',
    busy: false
  }
  private listeners = new Set<() => void>()
  private player: SdkPlayer | null = null
  private sdkDeviceId = ''
  private explicitDeviceId = ''
  private generation = 0
  private revision = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private readyTimeout: ReturnType<typeof setTimeout> | null = null
  private pendingDevice: { id: string; until: number } | null = null
  private polling = false
  private commandQueue = Promise.resolve()
  private lastVolume = 65
  private lastApiPoll = 0
  private playbackFault = false

  constructor(
    private readonly api: SpotifyAPI,
    private readonly loadSdk: () => Promise<SdkNamespace> = loadSpotifySdk,
    private readonly checkDrm: () => Promise<void> = assertWidevineSupport
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = (): PlaybackStore => this.store
  private update(patch: Partial<PlaybackStore>): void {
    this.store = { ...this.store, ...patch }
    for (const listener of this.listeners) listener()
  }
  private message(error: unknown): string {
    return error instanceof Error
      ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
      : 'Unable to contact Spotify. Please try again.'
  }

  async start(): Promise<void> {
    this.stop()
    const generation = this.generation
    this.update({ sdkStatus: 'connecting' })
    this.timer = setInterval(() => {
      void this.poll()
    }, 1000)
    void this.refreshDevices()
    void this.poll(true)
    try {
      await this.checkDrm()
      if (generation !== this.generation) return
      const sdk = await this.loadSdk()
      if (generation !== this.generation) return
      const player = new sdk.Player({
        name: 'Pastel Player',
        volume: 0.65,
        getOAuthToken: (callback) => {
          void this.api
            .getAccessToken()
            .then((token) => {
              if (generation === this.generation) callback(token)
            })
            .catch((error) => {
              if (generation === this.generation)
                this.update({ sdkStatus: 'unavailable', sdkError: this.message(error) })
            })
        }
      })
      this.player = player
      const current = (): boolean => generation === this.generation
      this.readyTimeout = setTimeout(() => {
        if (current() && this.store.sdkStatus === 'connecting')
          this.update({
            sdkStatus: 'unavailable',
            sdkError:
              'Spotify did not register the player in time. Reconnect or select another device.'
          })
      }, 20000)
      player.addListener('ready', ({ device_id }) => {
        if (!current() || this.playbackFault) return
        if (this.readyTimeout) clearTimeout(this.readyTimeout)
        this.sdkDeviceId = device_id
        this.update({
          sdkStatus: 'ready',
          sdkError: '',
          selectedDeviceId: this.explicitDeviceId || device_id
        })
        void this.refreshDevices()
      })
      player.addListener('not_ready', () => {
        if (!current()) return
        const selectedDeviceId =
          this.explicitDeviceId === this.sdkDeviceId ? '' : this.explicitDeviceId
        this.sdkDeviceId = ''
        this.update({
          sdkStatus: 'unavailable',
          selectedDeviceId,
          sdkError:
            'The local player went offline. Reconnect the player to restore audio in this app.'
        })
        void this.refreshDevices()
      })
      player.addListener('player_state_changed', (state) => {
        if (current()) this.acceptSdkState(state)
      })
      for (const event of [
        'initialization_error',
        'authentication_error',
        'account_error'
      ] as const) {
        player.addListener(event, () => {
          if (!current()) return
          const sdkError =
            event === 'initialization_error'
              ? 'Local audio initialization failed. Check the Widevine installation and Castlabs VMP signing; a Client ID alone cannot enable protected audio.'
              : event === 'account_error'
                ? 'Spotify Premium is required for this player.'
                : 'Spotify authentication failed. Disconnect and connect again.'
          this.sdkDeviceId = ''
          this.update({
            sdkStatus: 'unavailable',
            sdkError,
            selectedDeviceId: this.explicitDeviceId
          })
          if (this.readyTimeout) clearTimeout(this.readyTimeout)
        })
      }
      player.addListener('playback_error', ({ message }) => {
        if (!current() || this.playbackFault) return
        this.playbackFault = true
        this.revision++
        const detail = message
          .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
          .replace(/([?&](?:access_token|token|tok)=)[^&\s]+/gi, '$1[redacted]')
          .slice(0, 500)
        this.sdkDeviceId = ''
        this.explicitDeviceId = ''
        this.update({
          sdkStatus: 'unavailable',
          selectedDeviceId: '',
          sdkError: `Local playback stopped after a Spotify error: ${detail || 'Unknown playback error'}. Check the runtime VMP signature before reconnecting.`,
          error: ''
        })
        // A rejected license can trigger repeated automatic skips inside the SDK.
        // Pause this SDK instance and disconnect it once, without touching remote devices.
        let disconnected = false
        const disconnect = (): void => {
          if (!current() || disconnected) return
          disconnected = true
          player.disconnect()
        }
        const deadline = setTimeout(disconnect, 1000)
        void player
          .pause()
          .catch(() => {})
          .finally(() => {
            clearTimeout(deadline)
            disconnect()
          })
      })
      player.addListener('autoplay_failed', () => {
        if (current())
          this.update({ error: 'Playback needs a user gesture. Press Play to continue.' })
      })
      if (!(await player.connect()) && current())
        this.update({
          sdkStatus: 'unavailable',
          sdkError:
            this.store.sdkError ||
            'Spotify could not connect the player. Reconnect or select another device.'
        })
    } catch (error) {
      if (generation === this.generation)
        this.update({ sdkStatus: 'unavailable', sdkError: this.message(error) })
    }
  }

  stop(): void {
    this.generation++
    this.revision++
    if (this.timer) clearInterval(this.timer)
    if (this.readyTimeout) clearTimeout(this.readyTimeout)
    this.readyTimeout = null
    this.pendingDevice = null
    this.timer = null
    this.player?.disconnect()
    this.player = null
    this.sdkDeviceId = ''
    this.explicitDeviceId = ''
    this.lastApiPoll = 0
    this.playbackFault = false
    this.update({
      snapshot: null,
      devices: [],
      selectedDeviceId: '',
      sdkStatus: 'idle',
      sdkError: '',
      error: '',
      busy: false
    })
  }

  private acceptSdkState(state: SdkState | null): void {
    if (this.store.snapshot?.device?.id !== this.sdkDeviceId) return
    if (!state) {
      this.lastApiPoll = 0
      return
    }
    const track = state.track_window.current_track
    if (!track?.id || !track.uri?.startsWith('spotify:track:')) return
    this.update({
      snapshot: {
        ...this.store.snapshot,
        track: {
          id: track.id,
          uri: track.uri,
          title: track.name,
          artist: track.artists.map((artist) => artist.name).join(', '),
          album: track.album.name,
          duration: state.duration / 1000,
          imageUrl: track.album.images[0]?.url,
          externalUrl: `https://open.spotify.com/track/${track.id}`
        },
        playing: !state.paused,
        positionMs: state.position,
        durationMs: state.duration,
        contextUri: state.context?.uri ?? this.store.snapshot.contextUri,
        shuffle: state.shuffle ?? this.store.snapshot.shuffle,
        repeat:
          state.repeat_mode === 0
            ? 'off'
            : state.repeat_mode === 1
              ? 'context'
              : state.repeat_mode === 2
                ? 'track'
                : this.store.snapshot.repeat,
        receivedAt: Date.now(),
        disallowed: { ...this.store.snapshot.disallowed, ...state.disallows }
      }
    })
  }

  async refreshDevices(): Promise<void> {
    const generation = this.generation
    try {
      const devices = await this.api.getDevices()
      if (generation !== this.generation) return
      if (this.sdkDeviceId && !devices.some((device) => device.id === this.sdkDeviceId)) {
        devices.unshift({
          id: this.sdkDeviceId,
          name: 'Pastel Player',
          isActive: false,
          restricted: false,
          supportsVolume: true,
          volume: 65
        })
      }
      this.update({
        devices,
        selectedDeviceId: this.explicitDeviceId || this.sdkDeviceId
      })
    } catch (error) {
      if (generation === this.generation) this.update({ error: this.message(error) })
    }
  }

  async poll(force = false): Promise<void> {
    if (this.polling) return
    this.polling = true
    const generation = this.generation
    const revision = this.revision
    try {
      if (force || Date.now() - this.lastApiPoll >= 5000) {
        this.lastApiPoll = Date.now()
        const snapshot = await this.api.getPlayback()
        if (generation !== this.generation || revision !== this.revision) return
        if (
          this.pendingDevice &&
          (snapshot?.device?.id === this.pendingDevice.id || Date.now() > this.pendingDevice.until)
        )
          this.pendingDevice = null
        // An active Spotify Desktop must never steal the internal audio target.
        const selectedDeviceId = this.explicitDeviceId || this.sdkDeviceId
        const devices = snapshot?.device
          ? [
              snapshot.device,
              ...this.store.devices
                .filter((device) => device.id !== snapshot.device!.id)
                .map((device) => ({ ...device, isActive: false }))
            ]
          : this.store.devices.map((device) => ({ ...device, isActive: false }))
        this.update({ snapshot, selectedDeviceId, devices })
      } else if (this.player && this.store.snapshot?.device?.id === this.sdkDeviceId) {
        const state = await this.player.getCurrentState()
        if (generation === this.generation && revision === this.revision) this.acceptSdkState(state)
      }
    } catch (error) {
      if (generation === this.generation && revision === this.revision)
        this.update({ error: this.message(error) })
    } finally {
      this.polling = false
    }
  }

  clearError(): void {
    this.update({ error: '' })
  }

  private async command(operation: () => Promise<void>): Promise<void> {
    const generation = this.generation
    const task = this.commandQueue.then(async () => {
      if (generation !== this.generation) return
      this.revision++
      this.update({ busy: true, error: '' })
      try {
        await operation()
        if (generation === this.generation) {
          this.lastApiPoll = 0
          await this.poll(true)
        }
      } catch (error) {
        if (generation === this.generation) this.update({ error: this.message(error) })
      } finally {
        if (generation === this.generation) this.update({ busy: false })
      }
    })
    this.commandQueue = task.catch(() => {})
    return task
  }

  private selected(): string {
    if (!this.store.selectedDeviceId)
      throw new Error(
        this.store.sdkError ||
          'The local player is not ready. Wait for it to connect, or select Reconnect player.'
      )
    return this.store.selectedDeviceId
  }

  selectDevice(id: string): Promise<void> {
    return this.command(async () => {
      await this.api.transfer(id)
      this.explicitDeviceId = id
      this.pendingDevice = { id, until: Date.now() + 15000 }
      this.update({ selectedDeviceId: id })
      await this.refreshDevices()
    })
  }

  play(playlistUri?: string, trackUri?: string): Promise<void> {
    // Must run synchronously in the click's event path for browser autoplay rules.
    const activation = (
      this.store.selectedDeviceId === this.sdkDeviceId && this.player
        ? this.player.activateElement()
        : Promise.resolve()
    ).then(
      () => null,
      (error: unknown) => ({ error })
    )
    return this.command(async () => {
      const result = await activation
      if (result) throw result.error
      const id = this.selected()
      if (this.store.snapshot?.device?.id !== id) {
        await this.api.transfer(id)
        this.pendingDevice = { id, until: Date.now() + 15000 }
      }
      await this.api.play(id, playlistUri, trackUri)
    })
  }
  pause(): Promise<void> {
    return this.command(() => this.api.pause(this.selected()))
  }
  next(): Promise<void> {
    return this.command(() => this.api.next(this.selected()))
  }
  previous(): Promise<void> {
    return this.command(() => this.api.previous(this.selected()))
  }
  seek(positionMs: number): Promise<void> {
    return this.command(() => this.api.seek(this.selected(), positionMs))
  }
  volume(value: number): Promise<void> {
    return this.command(async () => {
      await this.api.setVolume(this.selected(), value)
      if (value > 0) this.lastVolume = value
    })
  }
  mute(): Promise<void> {
    return this.volume(this.store.snapshot?.device?.volume === 0 ? this.lastVolume : 0)
  }
  shuffle(enabled: boolean): Promise<void> {
    return this.command(() => this.api.setShuffle(this.selected(), enabled))
  }
  repeat(mode: RepeatMode): Promise<void> {
    return this.command(() => this.api.setRepeat(this.selected(), mode))
  }
}
