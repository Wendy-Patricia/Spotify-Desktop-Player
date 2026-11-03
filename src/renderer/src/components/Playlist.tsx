import { useState } from 'react'
import type { Track } from '../data/playlist'
import { formatTime } from '../data/playlist'
import AlbumArt from './AlbumArt'
import Icon from './Icon'
import type { SpotifyPlaylist } from '../../../shared/spotify'

export type LoadStatus = 'loading' | 'ready' | 'error'

interface PlaylistProps {
  tracks: Track[]
  status: LoadStatus
  currentId: string | undefined
  playing: boolean
  onSelect: (index: number) => void
  onRetry: () => void
  playlist: SpotifyPlaylist | null
  error: string
  disabled: boolean
  onOpen: () => void
}

export default function Playlist({
  tracks,
  status,
  currentId,
  playing,
  onSelect,
  onRetry,
  playlist,
  error,
  disabled,
  onOpen
}: PlaylistProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const filtered = tracks.filter((track) =>
    `${track.title} ${track.artist} ${track.album}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase().trim())
  )

  return (
    <section
      className="playlist-panel"
      id="playlist"
      aria-labelledby="playlist-title"
      tabIndex={-1}
    >
      <div className="playlist-intro">
        <span className="eyebrow">YOUR LITTLE EVERYDAY ESCAPE</span>
        <div className="playlist-title-row">
          <h2 id="playlist-title">
            {playlist?.name ?? 'Your music, on repeat'}
            <span>✳</span>
          </h2>
          <span className="playlist-sticker">
            good
            <br />
            vibes only
          </span>
        </div>
        <p>
          {playlist?.description.replace(/<[^>]*>/g, '') ||
            'Your favorite Spotify playlists, in a little pastel corner.'}
        </p>
        <div className="playlist-meta">
          <span className="curator-avatar">♫</span>
          <strong>{playlist?.owner ?? 'Spotify'}</strong>
          <span>·</span>
          <span>{tracks.length} songs</span>
          <span>·</span>
          <span>{Math.floor(tracks.reduce((sum, track) => sum + track.duration, 0) / 60)} min</span>
        </div>
        {playlist && (
          <button className="spotify-attribution" onClick={onOpen}>
            Open playlist on Spotify ↗
          </button>
        )}
      </div>
      <div className="playlist-toolbar">
        <div className="section-label">
          <Icon name="list" />
          <h3>Your playlist</h3>
        </div>
        <span className="track-count">{String(tracks.length).padStart(2, '0')} tracks</span>
      </div>
      <div className="search-field">
        <Icon name="search" />
        <input
          type="search"
          placeholder="Find your next favorite…"
          aria-label="Search songs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={status !== 'ready'}
        />
        {query && (
          <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}>
            <Icon name="close" />
          </button>
        )}
      </div>
      <div className="track-list" aria-busy={status === 'loading'}>
        {status === 'loading' && (
          <div role="status" aria-label="Loading playlist">
            <span className="sr-only">Loading playlist…</span>
            {Array.from({ length: 6 }, (_, index) => (
              <div className="track-skeleton" key={index}>
                <span className="skeleton skeleton-art" />
                <span className="skeleton skeleton-text" />
                <span className="skeleton skeleton-time" />
              </div>
            ))}
          </div>
        )}
        {status === 'error' && (
          <div className="empty-state" role="alert">
            <span className="empty-symbol">☁</span>
            <h3>A little intermission…</h3>
            <p>{error || 'Unable to load the playlist. Shall we try again?'}</p>
            <button className="text-button" onClick={onRetry}>
              <Icon name="refresh" />
              Try again
            </button>
          </div>
        )}
        {status === 'ready' && (
          <>
            <div className="list-column-labels">
              <span>#</span>
              <span>SONG / ARTIST</span>
              <span>DURATION</span>
            </div>
            <ol>
              {filtered.map((track) => {
                const index = tracks.indexOf(track)
                const active = currentId === track.id
                return (
                  <li key={`${track.id}-${index}`}>
                    <button
                      className={`track-row ${active ? 'track-active' : ''}`}
                      aria-current={active ? 'true' : undefined}
                      aria-label={`Play ${track.title}, ${track.artist}`}
                      onClick={() => onSelect(index)}
                      disabled={disabled}
                    >
                      <span className="track-number">
                        {active && playing ? (
                          <span className="equalizer">
                            <i />
                            <i />
                            <i />
                          </span>
                        ) : (
                          String(index + 1).padStart(2, '0')
                        )}
                      </span>
                      <AlbumArt track={track} small />
                      <span className="track-info">
                        <strong>{track.title}</strong>
                        <span>
                          {track.artist} <span className="track-album">· {track.album}</span>
                        </span>
                      </span>
                      <span className="track-duration">{formatTime(track.duration)}</span>
                      <span className="row-play">
                        <Icon name={active && playing ? 'pause' : 'play'} filled />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
            {filtered.length === 0 && (
              <div className="empty-state" role="status">
                <Icon name="search" />
                <h3>
                  {!playlist
                    ? 'Make yourself at home'
                    : query
                      ? 'No songs found'
                      : 'No playable songs'}
                </h3>
                <p>
                  {!playlist
                    ? 'Connect to Spotify and import a playlist to get started.'
                    : query
                      ? 'Try another title, artist, or album.'
                      : 'This playlist has no playable music tracks. Try another playlist.'}
                </p>
                {query && (
                  <button className="text-button" onClick={() => setQuery('')}>
                    Clear search
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
