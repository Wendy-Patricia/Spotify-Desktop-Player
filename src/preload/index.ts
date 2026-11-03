import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/api'
import type { DesktopAPI } from '../shared/api'
import { SPOTIFY_CHANNELS } from '../shared/spotify'

// Custom APIs for renderer
const api: DesktopAPI = {
  spotify: {
    getSession: () => ipcRenderer.invoke(SPOTIFY_CHANNELS.getSession),
    login: (clientId) => ipcRenderer.invoke(SPOTIFY_CHANNELS.login, clientId),
    logout: () => ipcRenderer.invoke(SPOTIFY_CHANNELS.logout),
    getAccessToken: () => ipcRenderer.invoke(SPOTIFY_CHANNELS.getAccessToken),
    importPlaylist: (input) => ipcRenderer.invoke(SPOTIFY_CHANNELS.importPlaylist, input),
    getDevices: () => ipcRenderer.invoke(SPOTIFY_CHANNELS.getDevices),
    getPlayback: () => ipcRenderer.invoke(SPOTIFY_CHANNELS.getPlayback),
    transfer: (deviceId) => ipcRenderer.invoke(SPOTIFY_CHANNELS.transfer, deviceId),
    play: (deviceId, playlistUri, trackUri) =>
      ipcRenderer.invoke(SPOTIFY_CHANNELS.play, deviceId, playlistUri, trackUri),
    pause: (deviceId) => ipcRenderer.invoke(SPOTIFY_CHANNELS.pause, deviceId),
    next: (deviceId) => ipcRenderer.invoke(SPOTIFY_CHANNELS.next, deviceId),
    previous: (deviceId) => ipcRenderer.invoke(SPOTIFY_CHANNELS.previous, deviceId),
    seek: (deviceId, positionMs) => ipcRenderer.invoke(SPOTIFY_CHANNELS.seek, deviceId, positionMs),
    setVolume: (deviceId, volume) =>
      ipcRenderer.invoke(SPOTIFY_CHANNELS.setVolume, deviceId, volume),
    setShuffle: (deviceId, enabled) =>
      ipcRenderer.invoke(SPOTIFY_CHANNELS.setShuffle, deviceId, enabled),
    setRepeat: (deviceId, mode) => ipcRenderer.invoke(SPOTIFY_CHANNELS.setRepeat, deviceId, mode),
    openSpotify: (uri) => ipcRenderer.invoke(SPOTIFY_CHANNELS.openSpotify, uri)
  },
  minimize: () => ipcRenderer.invoke(IPC_CHANNELS.minimize),
  toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.toggleMaximize),
  close: () => ipcRenderer.invoke(IPC_CHANNELS.close),
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
  getVersions: () => ipcRenderer.invoke(IPC_CHANNELS.getVersions)
}

// Never expose the generic IPC transport or Node APIs to the renderer.
contextBridge.exposeInMainWorld('api', api)
