export interface AppVersions {
  electron: string
  chrome: string
  node: string
}

export interface DesktopAPI {
  spotify: SpotifyAPI
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
  ping: () => Promise<'pong'>
  getVersions: () => Promise<AppVersions>
}

export const IPC_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  ping: 'app:ping',
  getVersions: 'app:get-versions'
} as const
import type { SpotifyAPI } from './spotify'
