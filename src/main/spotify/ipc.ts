import { ipcMain, shell } from 'electron'
import type { WebContents } from 'electron'
import { SPOTIFY_CHANNELS } from '../../shared/spotify'
import { assertTrustedIpcSender } from '../security'
import { SpotifyAuth } from './auth'
import { SpotifyService } from './service'
import { assertArgumentCount, spotifyUri } from './validation'

export async function registerSpotifyIpc(
  getContents: () => WebContents | undefined,
  rendererUrl: string
): Promise<() => void> {
  const auth = new SpotifyAuth()
  await auth.initialize()
  const service = new SpotifyService(auth)
  const operations: Record<
    keyof typeof SPOTIFY_CHANNELS,
    { min: number; max?: number; run: (...args: unknown[]) => unknown }
  > = {
    getSession: { min: 0, run: () => auth.session() },
    login: { min: 1, run: (clientId) => auth.login(clientId) },
    logout: { min: 0, run: () => auth.logout() },
    getAccessToken: { min: 0, run: () => auth.token() },
    importPlaylist: { min: 1, run: (input) => service.importPlaylist(input) },
    getDevices: { min: 0, run: () => service.devices() },
    getPlayback: { min: 0, run: () => service.playback() },
    transfer: { min: 1, run: (id) => service.transfer(id) },
    play: { min: 1, max: 3, run: (id, playlist, track) => service.play(id, playlist, track) },
    pause: { min: 1, run: (id) => service.pause(id) },
    next: { min: 1, run: (id) => service.next(id) },
    previous: { min: 1, run: (id) => service.previous(id) },
    seek: { min: 2, run: (id, position) => service.seek(id, position) },
    setVolume: { min: 2, run: (id, value) => service.volume(id, value) },
    setShuffle: { min: 2, run: (id, value) => service.shuffle(id, value) },
    setRepeat: { min: 2, run: (id, mode) => service.repeat(id, mode) },
    openSpotify: {
      min: 1,
      run: (input) => {
        if (typeof input !== 'string') throw new Error('Invalid Spotify link')
        const type = input.startsWith('spotify:playlist:') ? 'playlist' : 'track'
        const uri = spotifyUri(input, type)
        return shell.openExternal(`https://open.spotify.com/${type}/${uri.split(':')[2]}`)
      }
    }
  }
  for (const name of Object.keys(SPOTIFY_CHANNELS) as (keyof typeof SPOTIFY_CHANNELS)[]) {
    ipcMain.handle(SPOTIFY_CHANNELS[name], (event, ...args: unknown[]) => {
      assertTrustedIpcSender(event, getContents(), rendererUrl)
      const operation = operations[name]
      assertArgumentCount(args, operation.min, operation.max ?? operation.min)
      return operation.run(...args)
    })
  }
  return () => {
    auth.dispose()
    for (const channel of Object.values(SPOTIFY_CHANNELS)) ipcMain.removeHandler(channel)
  }
}
