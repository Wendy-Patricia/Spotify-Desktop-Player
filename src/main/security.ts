import type { IpcMainInvokeEvent } from 'electron'

export function isSpotifySdkUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate)
    return url.origin === 'https://sdk.scdn.co' && url.pathname === '/embedded/index.html'
  } catch {
    return false
  }
}

export function isAllowedMediaOrigin(candidate: string, rendererUrl: string): boolean {
  try {
    const actual = new URL(candidate)
    const expected = new URL(rendererUrl)
    return (
      actual.origin === 'https://sdk.scdn.co' ||
      (actual.protocol === expected.protocol &&
        actual.host === expected.host &&
        actual.protocol !== 'file:' &&
        actual.host !== '')
    )
  } catch {
    return false
  }
}

// Trust the loaded document, rather than every page sharing its origin.
export function isTrustedRendererUrl(candidate: string, rendererUrl: string): boolean {
  try {
    const actual = new URL(candidate)
    const expected = new URL(rendererUrl)
    actual.hash = ''
    expected.hash = ''
    return actual.href === expected.href
  } catch {
    return false
  }
}

export function assertTrustedIpcSender(
  event: IpcMainInvokeEvent,
  trustedContents: IpcMainInvokeEvent['sender'] | undefined,
  rendererUrl: string
): void {
  if (
    !trustedContents ||
    trustedContents.isDestroyed() ||
    event.sender !== trustedContents ||
    !event.senderFrame ||
    event.senderFrame !== trustedContents.mainFrame ||
    !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
  ) {
    throw new Error('Untrusted IPC sender')
  }
}

// Only explicitly trusted HTTPS destinations may reach an OS protocol handler.
export function isAllowedExternalUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'electron-vite.org' &&
      url.port === '' &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}
