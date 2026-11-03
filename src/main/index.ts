import { app, shell, screen, BrowserWindow, ipcMain, protocol, net, components } from 'electron'
import { join, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IPC_CHANNELS } from '../shared/api'
import type { AppVersions } from '../shared/api'
import {
  assertTrustedIpcSender,
  isAllowedExternalUrl,
  isTrustedRendererUrl,
  isSpotifySdkUrl,
  isAllowedMediaOrigin
} from './security'
import { registerSpotifyIpc } from './spotify/ipc'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pastel',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

const rendererUrl =
  is.dev && process.env['ELECTRON_RENDERER_URL']
    ? process.env['ELECTRON_RENDERER_URL']
    : 'pastel://player/index.html'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  // Create the browser window.
  const window = new BrowserWindow({
    width: Math.min(1040, width),
    height: Math.min(850, height),
    minWidth: 350,
    minHeight: 580,
    frame: false,
    backgroundColor: '#f8bed0',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      experimentalFeatures: false,
      devTools: is.dev
    }
  })

  mainWindow = window
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      callback(
        contents === window.webContents &&
          permission === 'mediaKeySystem' &&
          isAllowedMediaOrigin(details.requestingUrl, rendererUrl)
      )
    }
  )
  window.webContents.session.setPermissionCheckHandler((contents, permission, origin) => {
    return (
      contents === window.webContents &&
      permission === 'mediaKeySystem' &&
      isAllowedMediaOrigin(origin, rendererUrl)
    )
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, rendererUrl)) event.preventDefault()
  })
  window.webContents.on('will-frame-navigate', (event) => {
    if (
      event.isMainFrame
        ? !isTrustedRendererUrl(event.url, rendererUrl)
        : !isSpotifySdkUrl(event.url)
    ) {
      event.preventDefault()
    }
  })
  window.webContents.on('will-redirect', (event) => {
    if (
      event.isMainFrame
        ? !isTrustedRendererUrl(event.url, rendererUrl)
        : !isSpotifySdkUrl(event.url)
    )
      event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url).catch((error) => {
        console.error('Unable to open external link:', error)
      })
    }
    return { action: 'deny' }
  })

  // Development uses Vite; production uses a secure, local-only custom protocol.
  void window.loadURL(rendererUrl)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Castlabs installs/updates Widevine before the SDK's renderer is created.
  try {
    await components.whenReady()
  } catch {
    console.error('Widevine initialization failed. Local Spotify audio will be unavailable.')
  }
  protocol.handle('pastel', (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'player') return new Response('Not found', { status: 404 })
    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      return new Response('Bad request', { status: 400 })
    }
    const root = resolve(__dirname, '../renderer')
    const target = resolve(root, `.${pathname}`)
    if (!target.startsWith(`${root}${sep}`)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(target).href)
  })
  const disposeSpotify = await registerSpotifyIpc(() => mainWindow?.webContents, rendererUrl)
  app.on('before-quit', disposeSpotify)
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle(IPC_CHANNELS.ping, (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event, mainWindow?.webContents, rendererUrl)
    if (args.length !== 0) throw new Error('This operation takes no arguments')
    return 'pong'
  })
  ipcMain.handle(IPC_CHANNELS.getVersions, (event, ...args: unknown[]): AppVersions => {
    assertTrustedIpcSender(event, mainWindow?.webContents, rendererUrl)
    if (args.length !== 0) throw new Error('This operation takes no arguments')
    return {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    }
  })

  const windowActions = {
    [IPC_CHANNELS.minimize]: (): void => mainWindow?.minimize(),
    [IPC_CHANNELS.toggleMaximize]: (): void => {
      if (mainWindow?.isMaximized()) mainWindow.unmaximize()
      else mainWindow?.maximize()
    },
    [IPC_CHANNELS.close]: (): void => mainWindow?.close()
  }
  for (const [channel, action] of Object.entries(windowActions)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      assertTrustedIpcSender(event, mainWindow?.webContents, rendererUrl)
      if (args.length !== 0) throw new Error('This operation takes no arguments')
      action()
    })
  }

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
