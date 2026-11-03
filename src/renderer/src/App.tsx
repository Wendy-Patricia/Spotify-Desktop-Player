import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SpotifyPlaylist, SpotifySession, SpotifyTrack } from '../../shared/spotify'
import type { Track } from './data/playlist'
import { playbackPosition, SpotifyController } from './spotify/controller'
import type { PlaybackStore } from './spotify/controller'
import Icon from './components/Icon'
import Player from './components/Player'
import Playlist from './components/Playlist'
import type { LoadStatus } from './components/Playlist'
import { SPOTIFY_CONFIG } from '../../shared/spotify-config'

const emptyStore: PlaybackStore = {
  snapshot: null,
  devices: [],
  selectedDeviceId: '',
  sdkStatus: 'idle',
  sdkError: '',
  error: '',
  busy: false
}
const subscribeNothing = (): (() => void) => () => {}
const getEmptyStore = (): PlaybackStore => emptyStore

function readPreference(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
function savePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* Playback does not depend on browser storage. */
  }
}
function displayTrack(track: SpotifyTrack): Track {
  return { ...track, color: 'lilac', motif: 'star' }
}
function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'Unable to contact Spotify. Please try again.'
}

function App(): React.JSX.Element {
  const api = window.api?.spotify
  const [controller] = useState(() => (api ? new SpotifyController(api) : null))
  const store = useSyncExternalStore(
    controller?.subscribe ?? subscribeNothing,
    controller?.getSnapshot ?? getEmptyStore
  )
  const [session, setSession] = useState<SpotifySession | null>(null)
  const clientId = SPOTIFY_CONFIG.clientId
  const [signingIn, setSigningIn] = useState(false)
  const [playlist, setPlaylist] = useState<SpotifyPlaylist | null>(null)
  const [playlistInput, setPlaylistInput] = useState<string>(
    () => SPOTIFY_CONFIG.playlistUrl || readPreference('spotify:last-playlist')
  )
  const [status, setStatus] = useState<LoadStatus>('ready')
  const [playlistError, setPlaylistError] = useState('')
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [favorites, setFavorites] = useState<string[]>([])
  const importRevision = useRef(0)
  const connected = session?.connected ?? false
  const snapshot = store.snapshot?.device?.id === store.selectedDeviceId ? store.snapshot : null
  const tracks = playlist?.tracks.map(displayTrack) ?? []
  const current = snapshot?.track ?? playlist?.tracks[0]
  const track = current ? displayTrack(current) : undefined
  const device =
    store.devices.find((item) => item.id === store.selectedDeviceId) ?? snapshot?.device
  const isSelectedActive = !!snapshot?.device && snapshot.device.id === store.selectedDeviceId
  const disallowed = isSelectedActive ? (snapshot?.disallowed ?? {}) : {}
  const disabled =
    !connected ||
    !store.selectedDeviceId ||
    store.busy ||
    (!playlist?.tracks.length && !snapshot?.track)
  const repeat =
    snapshot?.repeat === 'context' ? 'all' : snapshot?.repeat === 'track' ? 'one' : 'off'

  useEffect(() => {
    let active = true
    if (api) {
      void api
        .getSession()
        .then((result) => {
          if (active) {
            setSession(result)
          }
        })
        .catch((failure) => {
          if (active) setError(errorMessage(failure))
        })
    }
    return () => {
      active = false
      // Invalidate async imports when this component is unmounted.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      importRevision.current++
    }
  }, [api])

  useEffect(() => {
    if (!connected || !controller) return
    void controller.start()
    return () => controller.stop()
  }, [connected, controller])

  useEffect(() => {
    if (!api || !connected || !SPOTIFY_CONFIG.playlistUrl) return
    const revision = ++importRevision.current
    let active = true
    const load = async (): Promise<void> => {
      setStatus('loading')
      setPlaylistError('')
      try {
        const result = await api.importPlaylist(SPOTIFY_CONFIG.playlistUrl)
        if (!active || revision !== importRevision.current) return
        setPlaylist(result)
        setStatus('ready')
        savePreference('spotify:last-playlist', result.uri)
      } catch (failure) {
        if (active && revision === importRevision.current) {
          setStatus('error')
          setPlaylistError(errorMessage(failure))
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [api, connected])

  useEffect(() => {
    if (!snapshot?.playing) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [snapshot?.playing])

  const importPlaylist = async (): Promise<void> => {
    if (!api || !connected) return
    const revision = ++importRevision.current
    setStatus('loading')
    setPlaylistError('')
    try {
      const result = await api.importPlaylist(playlistInput)
      if (revision !== importRevision.current) return
      setPlaylist(result)
      setStatus('ready')
      savePreference('spotify:last-playlist', result.uri)
    } catch (failure) {
      if (revision === importRevision.current) {
        setStatus('error')
        setPlaylistError(errorMessage(failure))
      }
    }
  }

  const signIn = async (): Promise<void> => {
    if (!api) return
    setSigningIn(true)
    setError('')
    try {
      setSession(await api.login(clientId))
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setSigningIn(false)
    }
  }
  const disconnect = async (): Promise<void> => {
    importRevision.current++
    controller?.stop()
    setPlaylist(null)
    setStatus('ready')
    try {
      await api?.logout()
      setSession((previous) => (previous ? { ...previous, connected: false } : null))
    } catch (failure) {
      setError(errorMessage(failure))
    }
    setSigningIn(false)
  }
  const openSpotify = (uri: string): void => {
    void api?.openSpotify(uri).catch((failure) => setError(errorMessage(failure)))
  }
  const playPause = (): void => {
    if (!controller) return
    if (snapshot?.playing && isSelectedActive) {
      void controller.pause()
      return
    }
    if (playlist && (snapshot?.contextUri !== playlist.uri || !snapshot.track))
      void controller.play(playlist.uri)
    else void controller.play()
  }
  const windowAction = (action: 'minimize' | 'toggleMaximize' | 'close'): void => {
    void window.api?.[action]().catch((failure) => setError(errorMessage(failure)))
  }

  return (
    <div className="app-shell">
      <header className="titlebar">
        <span className="app-wordmark">✳ pastel player</span>
        <span className="titlebar-caption">a little music, a little magic</span>
        {window.api && (
          <div className="window-controls">
            <button
              className="window-dot minimize"
              aria-label="Minimize window"
              onClick={() => windowAction('minimize')}
            >
              −
            </button>
            <button
              className="window-dot maximize"
              aria-label="Maximize or restore window"
              onClick={() => windowAction('toggleMaximize')}
            >
              ✣
            </button>
            <button
              className="window-dot close"
              aria-label="Close window"
              onClick={() => windowAction('close')}
            >
              ×
            </button>
          </div>
        )}
      </header>
      <div className="connection-area">
        <details className="connection-panel" open={connected ? undefined : true}>
          <summary>
            <span className={`status-dot ${connected ? 'connected-dot' : ''}`} />
            {connected ? 'Connected to Spotify' : 'Connect your Spotify account'}
            <span className="connection-hint">
              {connected
                ? (device?.name ?? 'Choose a playback device')
                : 'Spotify Premium required'}
            </span>
          </summary>
          {!api ? (
            <p role="alert">Open this app in Electron to connect to Spotify.</p>
          ) : (
            <>
              {!connected && (
                <form
                  className="connection-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void signIn()
                  }}
                >
                  <p>Your Spotify app and playlist are configured in the source code.</p>
                  <button className="text-button" type="submit" disabled={signingIn || !session}>
                    {signingIn ? 'Complete sign-in in your browser…' : 'Connect Spotify'}
                  </button>
                  {signingIn && (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        void disconnect()
                      }}
                    >
                      Cancel sign-in
                    </button>
                  )}
                  <p className="setup-hint">
                    Sign in once to authorize this player. No Spotify desktop app or developer
                    dashboard needs to stay open. In your Spotify app settings, add{' '}
                    <code>{session?.redirectUri ?? 'http://127.0.0.1:43821/callback'}</code> as a
                    Redirect URI. No client secret is needed.
                  </p>
                </form>
              )}
              {connected && (
                <div className="connected-settings">
                  <p>
                    Audio output: <strong>this app</strong> ·{' '}
                    {store.sdkStatus === 'ready'
                      ? 'Player ready'
                      : store.sdkStatus === 'connecting'
                        ? 'Preparing local audio…'
                        : 'Local audio unavailable'}
                  </p>
                  <button
                    className="text-button"
                    onClick={() => {
                      void controller?.start()
                    }}
                  >
                    Reconnect player
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      void disconnect()
                    }}
                  >
                    Disconnect
                  </button>
                  {!session?.persistent && (
                    <p className="setup-hint">
                      Secure storage is unavailable. Your session will be kept in memory only.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </details>
        {connected && !SPOTIFY_CONFIG.playlistUrl && (
          <form
            className="import-form"
            onSubmit={(event) => {
              event.preventDefault()
              void importPlaylist()
            }}
          >
            <label className="sr-only" htmlFor="playlist-url">
              Spotify playlist link or URI
            </label>
            <input
              id="playlist-url"
              value={playlistInput}
              onChange={(event) => setPlaylistInput(event.target.value)}
              placeholder="Paste a Spotify playlist link or URI…"
              required
              disabled={status === 'loading'}
            />
            <button className="text-button" disabled={status === 'loading'}>
              {status === 'loading' ? 'Importing…' : 'Import playlist'}
            </button>
          </form>
        )}
        {store.sdkError && (
          <p className="connection-warning" role="status">
            {store.sdkError}
          </p>
        )}
        {connected && !store.selectedDeviceId && store.sdkStatus !== 'connecting' && (
          <p className="connection-warning">
            Local audio is not ready. Reconnect the player after resolving the Widevine or account
            error shown above.
          </p>
        )}
      </div>
      <main className="main-layout">
        <Player
          key={track?.id ?? 'empty'}
          track={track}
          state={{
            position: playbackPosition(snapshot, Math.max(now, snapshot?.receivedAt ?? 0)) / 1000,
            playing: snapshot?.playing ?? false,
            shuffle: snapshot?.shuffle ?? false,
            repeat,
            volume: snapshot?.device?.volume ?? 65,
            muted: snapshot?.device?.volume === 0
          }}
          disabled={disabled}
          onPlayPause={playPause}
          onPrevious={() => {
            void controller?.previous()
          }}
          onNext={() => {
            void controller?.next()
          }}
          onSeek={(seconds) => {
            void controller?.seek(Math.round(seconds * 1000))
          }}
          onVolume={(value) => {
            void controller?.volume(value)
          }}
          onMute={() => {
            void controller?.mute()
          }}
          onShuffle={() => {
            void controller?.shuffle(!snapshot?.shuffle)
          }}
          onRepeat={() => {
            void controller?.repeat(
              snapshot?.repeat === 'off' || !snapshot
                ? 'context'
                : snapshot.repeat === 'context'
                  ? 'track'
                  : 'off'
            )
          }}
          volumeDisabled={!isSelectedActive || !device?.supportsVolume}
          playDisabled={snapshot?.playing ? disallowed.pausing : disallowed.resuming}
          seekDisabled={!isSelectedActive || disallowed.seeking}
          nextDisabled={!isSelectedActive || disallowed.skipping_next}
          previousDisabled={!isSelectedActive || disallowed.skipping_prev}
          shuffleDisabled={!isSelectedActive || disallowed.toggling_shuffle}
          repeatDisabled={
            !isSelectedActive ||
            disallowed.toggling_repeat_context ||
            disallowed.toggling_repeat_track
          }
          liked={!!track && favorites.includes(track.id)}
          onLike={() => {
            if (track)
              setFavorites((previous) =>
                previous.includes(track.id)
                  ? previous.filter((id) => id !== track.id)
                  : [...previous, track.id]
              )
          }}
          onOpenTrack={() => {
            if (track?.uri) openSpotify(track.uri)
          }}
          onShowPlaylist={() => {
            document
              .getElementById('playlist')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            document.getElementById('playlist')?.focus({ preventScroll: true })
          }}
        />
        <Playlist
          tracks={tracks}
          status={status}
          currentId={snapshot?.track?.id}
          playing={snapshot?.playing ?? false}
          playlist={playlist}
          error={playlistError}
          disabled={disabled || status !== 'ready'}
          onOpen={() => {
            if (playlist) openSpotify(playlist.uri)
          }}
          onRetry={() => {
            void importPlaylist()
          }}
          onSelect={(index) => {
            if (!playlist) return
            if (
              snapshot?.track?.uri === tracks[index].uri &&
              snapshot?.contextUri === playlist.uri &&
              isSelectedActive
            )
              playPause()
            else void controller?.play(playlist.uri, tracks[index].uri)
          }}
        />
      </main>
      <footer className="app-footer">
        <span>
          <span className="status-dot" />
          {!connected
            ? 'Connect Spotify to get started'
            : store.busy
              ? 'Updating Spotify…'
              : snapshot?.playing
                ? `Playing on ${snapshot.device?.name ?? 'Spotify'}`
                : 'Your little music corner'}
        </span>
        <span className="demo-badge">
          {store.sdkStatus === 'connecting'
            ? 'CONNECTING PLAYER…'
            : connected
              ? 'SPOTIFY CONNECT'
              : 'SPOTIFY PREMIUM'}
        </span>
      </footer>
      {(error || store.error) && (
        <div className="window-error" role="alert">
          {error || store.error}
          <button
            onClick={() => {
              setError('')
              controller?.clearError()
            }}
            aria-label="Dismiss notification"
          >
            <Icon name="close" />
          </button>
        </div>
      )}
    </div>
  )
}

export default App
