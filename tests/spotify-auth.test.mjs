import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'
import { createLoader } from './ts-loader.mjs'

function harness(options = {}) {
  const files = new Map()
  let authorizeUrl
  let handler
  const tokenRequests = []
  const load = createLoader(
    {
      electron: {
        app: { getPath: () => '/session' },
        safeStorage: {
          isEncryptionAvailable: () => options.encrypted !== false,
          getSelectedStorageBackend: () => 'secret-service',
          encryptString: (text) => Buffer.from(`encrypted:${Buffer.from(text).toString('base64')}`),
          decryptString: (data) => Buffer.from(data.toString().slice(10), 'base64').toString()
        },
        shell: {
          openExternal: async (url) => {
            authorizeUrl = new URL(url)
          }
        }
      },
      'node:fs/promises': {
        readFile: async (path) => {
          if (!files.has(path)) throw new Error('missing')
          return files.get(path)
        },
        writeFile: async (path, content) => {
          files.set(path, content)
        },
        rename: async (from, to) => {
          files.set(to, files.get(from))
          files.delete(from)
        },
        unlink: async (path) => {
          files.delete(path)
        }
      },
      'node:http': {
        createServer: (callback) => {
          handler = callback
          return {
            on() {
              /* No server errors in this fixture. */
            },
            listen(_port, host, ready) {
              assert.equal(host, '127.0.0.1')
              ready()
            },
            close() {
              /* There are no real sockets. */
            },
            closeAllConnections() {
              /* There are no real sockets. */
            }
          }
        }
      }
    },
    {
      fetch: async (_url, request) => {
        tokenRequests.push(new URLSearchParams(request.body))
        return options.fetch
          ? options.fetch()
          : new Response(
              JSON.stringify({
                access_token: 'access-token',
                refresh_token: 'secret-refresh-token',
                expires_in: 3600
              })
            )
      }
    }
  )
  const { SpotifyAuth, createPkce, validState } = load('../src/main/spotify/auth.ts')
  const auth = new SpotifyAuth()
  const callback = (params) => {
    let status = 200
    const response = {
      setHeader() {
        /* Headers are not transmitted by the fixture. */
      },
      writeHead(value) {
        status = value
        return this
      },
      end() {
        /* The fixture records only the response status. */
      }
    }
    handler(
      {
        method: 'GET',
        headers: { host: '127.0.0.1:43821' },
        url: `/callback?${new URLSearchParams(params)}`
      },
      response
    )
    return status
  }
  const login = async () => {
    const promise = auth.login('0123456789abcdef0123456789abcdef')
    await flush()
    callback({ code: 'authorization-code', state: authorizeUrl.searchParams.get('state') })
    return promise
  }
  return {
    auth,
    files,
    tokenRequests,
    callback,
    login,
    createPkce,
    validState,
    getUrl: () => authorizeUrl
  }
}

test('PKCE uses an S256 challenge with cryptographically random state and verifier', () => {
  const { createPkce, validState } = harness()
  const first = createPkce(),
    second = createPkce()
  assert.equal(first.challenge, createHash('sha256').update(first.verifier).digest('base64url'))
  assert.notEqual(first.verifier, second.verifier)
  assert.notEqual(first.state, second.state)
  assert.equal(validState(first.state, first.state), true)
  assert.equal(validState('wrong', first.state), false)
  assert.equal(validState('é'.repeat(64), first.state), false)
})

test('OAuth rejects a mismatched state and keeps the correct callback available', async () => {
  const { auth, callback, getUrl } = harness()
  const login = auth.login('0123456789abcdef0123456789abcdef')
  await flush()
  assert.equal(callback({ code: 'bad-code', state: 'wrong' }), 400)
  assert.equal(callback({ code: 'good-code', state: getUrl().searchParams.get('state') }), 200)
  assert.equal((await login).connected, true)
})

test('tokens stay in main, refresh tokens are encrypted, and the callback URI is exact', async () => {
  const { login, auth, files, tokenRequests, getUrl } = harness()
  const session = await login()
  assert.equal(session.connected, true)
  assert.equal(session.accessToken, undefined)
  assert.equal(session.refreshToken, undefined)
  assert.equal(getUrl().searchParams.get('redirect_uri'), 'http://127.0.0.1:43821/callback')
  assert.equal(getUrl().searchParams.get('code_challenge_method'), 'S256')
  assert.equal(tokenRequests[0].get('grant_type'), 'authorization_code')
  assert.equal(tokenRequests[0].get('client_secret'), null)
  assert.ok([...files.values()].every((content) => !content.includes('secret-refresh-token')))
  assert.equal(await auth.token(), 'access-token')
  await auth.logout()
  assert.equal(files.size, 0)
  assert.equal(auth.session().connected, false)
})

test('concurrent token refresh requests share one exchange', async () => {
  const { auth, login, tokenRequests } = harness()
  await login()
  await Promise.all([auth.token(true), auth.token(true), auth.token(true)])
  assert.equal(tokenRequests.length, 2)
  assert.equal(tokenRequests[1].get('grant_type'), 'refresh_token')
})

test('without OS encryption no refresh token is written to disk', async () => {
  const { auth, login, files } = harness({ encrypted: false })
  await login()
  assert.equal(auth.session().persistent, false)
  assert.ok(
    [...files.values()].every((content) => !Object.hasOwn(JSON.parse(content), 'refreshToken'))
  )
})

test('logout cancels pending browser sign-in and clears account state', async () => {
  const { auth } = harness()
  const promise = auth.login('0123456789abcdef0123456789abcdef')
  const rejection = assert.rejects(promise, /canceled/)
  await auth.logout()
  await rejection
  assert.equal(auth.session().connected, false)
})

test('a refresh response arriving after logout cannot resurrect the session', async () => {
  let release
  let count = 0
  const fixture = harness({
    fetch: () => {
      if (count++ === 0)
        return new Response(
          JSON.stringify({ access_token: 'initial', refresh_token: 'refresh', expires_in: 3600 })
        )
      return new Promise((resolve) => {
        release = resolve
      })
    }
  })
  await fixture.login()
  const refresh = fixture.auth.token(true)
  const rejection = assert.rejects(refresh, /session changed/)
  await flush()
  await fixture.auth.logout()
  release(
    new Response(
      JSON.stringify({ access_token: 'late', refresh_token: 'late-refresh', expires_in: 3600 })
    )
  )
  await rejection
  assert.equal(fixture.auth.session().connected, false)
  assert.equal(fixture.files.size, 0)
})
