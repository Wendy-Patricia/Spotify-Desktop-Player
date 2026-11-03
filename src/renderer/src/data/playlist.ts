import type { SpotifyTrack } from '../../../shared/spotify'

export interface Track extends SpotifyTrack {
  color: string
  motif: 'bunny' | 'star' | 'flower'
}

export function formatTime(seconds: number): string {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
}
