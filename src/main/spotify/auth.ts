import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage, shell } from 'electron'
import type { SpotifySession } from '../../shared/spotify'
import { clientId as validateClientId } from './validation'
import { SPOTIFY_CONFIG } from '../../shared/spotify-config'

export const REDIRECT_URI = 'http://127.0.0.1:43821/callback'
export const SCOPES = [
  'streaming',
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative'
].join(' ')

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(64).toString('base64url')
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(32).toString('base64url')
  }
}

export function validState(actual: string | null, expected: string): boolean {
  if (!actual) return false
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

export class SpotifyAuth {
  private client: string = SPOTIFY_CONFIG.clientId
  private refreshToken = ''
  private accessToken = ''
  private expiresAt = 0
  private refreshing: Promise<string> | null = null
  private cancelLogin: (() => void) | null = null
  private generation = 0
  private persistence: Promise<void> = Promise.resolve()
  private signingIn = false
  private readonly storagePath = join(app.getPath('userData'), 'spotify-session.json')

  private canPersist(): boolean {
    return (
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
    )
  }

  async initialize(): Promise<void> {
    try {
      const stored = JSON.parse(await readFile(this.storagePath, 'utf8'))
      const savedClient = validateClientId(stored.clientId)
      if (SPOTIFY_CONFIG.clientId && savedClient !== SPOTIFY_CONFIG.clientId) return
      this.client = SPOTIFY_CONFIG.clientId || savedClient
      if (typeof stored.refreshToken === 'string' && this.canPersist()) {
        this.refreshToken = safeStorage.decryptString(Buffer.from(stored.refreshToken, 'base64'))
      }
    } catch {
      /* Missing or unreadable session means signed out. */
    }
  }

  session(): SpotifySession {
    return {
      connected: !!(this.refreshToken || this.accessToken),
      clientId: this.client,
      redirectUri: REDIRECT_URI,
      persistent: this.canPersist()
    }
  }

  private async persist(): Promise<void> {
    const refreshToken =
      this.refreshToken && this.canPersist()
        ? safeStorage.encryptString(this.refreshToken).toString('base64')
        : undefined
    const generation = this.generation
    const content = JSON.stringify({ clientId: this.client, refreshToken })
    const task = this.persistence
      .catch(() => {})
      .then(async () => {
        if (generation !== this.generation) return
        const temporary = `${this.storagePath}.tmp`
        await writeFile(temporary, content, { mode: 0o600 })
        if (generation !== this.generation) {
          await unlink(temporary).catch(() => {})
          return
        }
        await rename(temporary, this.storagePath)
      })
    this.persistence = task
    await task
  }

  private async exchange(parameters: Record<string, string>, generation: number): Promise<string> {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.client, ...parameters }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error'
    })
    if (generation !== this.generation)
      throw new Error('Spotify session changed. Please connect again.')
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        this.accessToken = ''
        this.refreshToken = ''
        this.expiresAt = 0
        await this.persist()
        throw new Error('Spotify authorization expired or was rejected. Please connect again.')
      }
      throw new Error('Spotify sign-in is temporarily unavailable. Please try again.')
    }
    const token = (await response.json()) as TokenResponse
    if (!token.access_token || !Number.isFinite(token.expires_in))
      throw new Error('Invalid Spotify token response')
    if (generation !== this.generation)
      throw new Error('Spotify session changed. Please connect again.')
    this.accessToken = token.access_token
    this.expiresAt = Date.now() + token.expires_in * 1000
    this.refreshToken = token.refresh_token ?? this.refreshToken
    await this.persist()
    return this.accessToken
  }

  async token(force = false): Promise<string> {
    if (!force && this.accessToken && Date.now() < this.expiresAt - 60000) return this.accessToken
    if (this.refreshing) return this.refreshing
    if (!this.refreshToken) throw new Error('Connect your Spotify account first.')
    this.refreshing = this.exchange(
      { grant_type: 'refresh_token', refresh_token: this.refreshToken },
      this.generation
    )
    try {
      return await this.refreshing
    } finally {
      this.refreshing = null
    }
  }

  async login(input: unknown): Promise<SpotifySession> {
    if (this.signingIn) throw new Error('A Spotify sign-in is already in progress.')
    this.signingIn = true
    try {
      return await this.authorize(input)
    } finally {
      this.signingIn = false
    }
  }

  private async authorize(input: unknown): Promise<SpotifySession> {
    if (this.cancelLogin)
      throw new Error('A Spotify sign-in is already in progress. Complete it in your browser.')
    const nextClient = validateClientId(SPOTIFY_CONFIG.clientId || input)
    this.client = nextClient
    const generation = ++this.generation
    this.accessToken = ''
    this.refreshToken = ''
    this.expiresAt = 0
    const { verifier, challenge, state } = createPkce()
    const code = await new Promise<string>((resolve, reject) => {
      let finished = false
      let callbackReceived = false
      const server = createServer((request, response) => {
        response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        let url: URL
        try {
          url = new URL(request.url ?? '/', REDIRECT_URI)
        } catch {
          response.writeHead(400).end('Invalid request')
          return
        }
        if (
          request.method !== 'GET' ||
          request.headers.host !== '127.0.0.1:43821' ||
          url.origin !== new URL(REDIRECT_URI).origin ||
          url.pathname !== '/callback'
        ) {
          response.writeHead(404).end('Not found')
          return
        }
        if (callbackReceived || !validState(url.searchParams.get('state'), state)) {
          response.writeHead(400).end('Invalid sign-in request. Return to Pastel Player.')
          return
        }
        callbackReceived = true
        if (url.searchParams.has('error') || !url.searchParams.get('code')) {
          response.end('Spotify sign-in was canceled. You can return to Pastel Player.')
          finish(new Error('Spotify sign-in was canceled.'))
          return
        }
        response.end('Connected to Spotify. You can close this tab and return to Pastel Player.')
        finish(undefined, url.searchParams.get('code')!)
      })
      const finish = (error?: Error, code?: string): void => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        this.cancelLogin = null
        server.close()
        if (error) server.closeAllConnections()
        if (error) reject(error)
        else resolve(code!)
      }
      const timer = setTimeout(
        () => finish(new Error('Spotify sign-in timed out. Please try again.')),
        180000
      )
      this.cancelLogin = () => finish(new Error('Spotify sign-in was canceled.'))
      server.on('error', () =>
        finish(
          new Error(
            'Unable to open the Spotify callback port (43821). Close other instances and try again.'
          )
        )
      )
      server.listen(43821, '127.0.0.1', () => {
        const url = new URL('https://accounts.spotify.com/authorize')
        url.search = new URLSearchParams({
          client_id: this.client,
          response_type: 'code',
          redirect_uri: REDIRECT_URI,
          scope: SCOPES,
          state,
          code_challenge_method: 'S256',
          code_challenge: challenge
        }).toString()
        void shell
          .openExternal(url.href)
          .catch(() => finish(new Error('Unable to open the browser for Spotify sign-in.')))
      })
    })
    await this.exchange(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier
      },
      generation
    )
    return this.session()
  }

  async logout(): Promise<void> {
    this.generation++
    this.cancelLogin?.()
    this.accessToken = ''
    this.refreshToken = ''
    this.expiresAt = 0
    await this.persistence.catch(() => {})
    await unlink(this.storagePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }

  dispose(): void {
    this.cancelLogin?.()
  }
}
