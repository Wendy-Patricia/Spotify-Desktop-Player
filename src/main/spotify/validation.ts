export function boundedNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error('Invalid numeric argument')
  }
  return Math.round(value)
}

export function deviceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new Error('Select an available Spotify device first.')
  }
  return value
}

export function spotifyUri(value: unknown, type: 'playlist' | 'track'): string {
  if (typeof value !== 'string' || !new RegExp(`^spotify:${type}:[a-zA-Z0-9]{22}$`).test(value)) {
    throw new Error(`Invalid Spotify ${type} URI`)
  }
  return value
}

export function playlistId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048)
    throw new Error('Enter a Spotify playlist link or URI.')
  const input = value.trim()
  if (/^[a-zA-Z0-9]{22}$/.test(input)) return input
  if (/^spotify:playlist:[a-zA-Z0-9]{22}$/.test(input)) return input.split(':')[2]
  try {
    const url = new URL(input)
    const match = url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?playlist\/([a-zA-Z0-9]{22})\/?$/)
    if (
      url.protocol === 'https:' &&
      url.hostname === 'open.spotify.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      match
    )
      return match[1]
  } catch {
    /* Invalid links never reach the network. */
  }
  throw new Error('Enter a valid Spotify playlist link, ID or URI.')
}

export function clientId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{32}$/.test(value.trim())) {
    throw new Error('Enter the 32-character Client ID from your Spotify app settings.')
  }
  return value.trim()
}

export function assertArgumentCount(args: unknown[], min: number, max = min): void {
  if (args.length < min || args.length > max) throw new Error('Invalid operation arguments')
}
