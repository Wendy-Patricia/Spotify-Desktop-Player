import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Track } from '../data/playlist'
import { formatTime } from '../data/playlist'
import AlbumArt from './AlbumArt'
import Icon from './Icon'

interface PlayerProps {
  track: Track | undefined
  state: {
    position: number
    playing: boolean
    shuffle: boolean
    repeat: 'off' | 'all' | 'one'
    volume: number
    muted: boolean
  }
  onPlayPause: () => void
  onPrevious: () => void
  onNext: () => void
  onSeek: (seconds: number) => void
  onVolume: (volume: number) => void
  onMute: () => void
  onShuffle: () => void
  onRepeat: () => void
  volumeDisabled?: boolean
  playDisabled?: boolean
  seekDisabled?: boolean
  nextDisabled?: boolean
  previousDisabled?: boolean
  shuffleDisabled?: boolean
  repeatDisabled?: boolean
  onOpenTrack?: () => void
  disabled: boolean
  liked: boolean
  onLike: () => void
  onShowPlaylist: () => void
}

function rangeStyle(value: number): CSSProperties {
  return { '--progress': `${value}%` } as CSSProperties
}

export default function Player({
  track,
  state,
  onPlayPause,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onMute,
  onShuffle,
  onRepeat,
  volumeDisabled,
  playDisabled,
  seekDisabled,
  nextDisabled,
  previousDisabled,
  shuffleDisabled,
  repeatDisabled,
  onOpenTrack,
  disabled,
  liked,
  onLike,
  onShowPlaylist
}: PlayerProps): React.JSX.Element {
  const [seekDraft, setSeekDraft] = useState<number | null>(null)
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null)
  const duration = track?.duration ?? 0
  const position = seekDraft ?? state.position
  const volume = volumeDraft ?? (state.muted ? 0 : state.volume)
  const commitSeek = (): void => {
    if (seekDraft !== null) {
      onSeek(seekDraft)
      setSeekDraft(null)
    }
  }
  const commitVolume = (): void => {
    if (volumeDraft !== null) {
      onVolume(volumeDraft)
      setVolumeDraft(null)
    }
  }
  const repeatLabel = {
    off: 'Repeat off',
    all: 'Repeat playlist',
    one: 'Repeat song'
  }[state.repeat]

  return (
    <section className="player" aria-label="Music player">
      <div className="now-playing-heading">
        <span className="tiny-star">✦</span> NOW PLAYING <span className="tiny-star">✦</span>
      </div>
      <h1
        className="track-pill"
        aria-live="polite"
        title={track ? `${track.artist} — ${track.title}` : undefined}
      >
        {track ? `${track.artist} — ${track.title}` : 'Your music starts here'}
      </h1>
      <div className={`cover-card ${disabled ? 'is-unavailable' : ''}`}>
        {track ? (
          <AlbumArt track={track} />
        ) : (
          <div className="cover-skeleton empty-cover">
            <Icon name="music" />
            <span>Connect. Pick a playlist. Press play.</span>
          </div>
        )}
        <div className="cover-caption">
          <span>{track?.album ?? 'Waiting for your music'}</span>
          <span className="disc-label">{state.playing && !disabled ? '♫ ON AIR' : '♡ SIDE A'}</span>
        </div>
        <div className="progress-block">
          <div className="time-labels">
            <span>{formatTime(position)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          <input
            className="song-progress"
            type="range"
            min="0"
            max={duration || 1}
            value={Math.min(position, duration)}
            step="1"
            disabled={disabled || seekDisabled}
            aria-label="Song progress"
            aria-valuetext={`${formatTime(position)} of ${formatTime(duration)}`}
            style={rangeStyle(duration ? (position / duration) * 100 : 0)}
            onChange={(event) => setSeekDraft(Number(event.target.value))}
            onPointerUp={commitSeek}
            onKeyUp={commitSeek}
            onBlur={commitSeek}
            onPointerCancel={() => setSeekDraft(null)}
          />
        </div>
      </div>
      <div className="player-extras">
        <button
          className={`icon-button like-button ${liked ? 'is-liked' : ''}`}
          aria-label={liked ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={liked}
          disabled={!track}
          onClick={onLike}
        >
          <Icon name="heart" filled={liked} />
        </button>
        <span className="playback-caption">
          {state.playing && !disabled ? 'a little feel-good music' : 'your next favorite song'}
        </span>
        <button className="icon-button" aria-label="Show playlist" onClick={onShowPlaylist}>
          <Icon name="list" />
        </button>
      </div>
      <div className="transport">
        <button
          className="icon-button skip-button"
          aria-label="Previous song"
          disabled={disabled || previousDisabled}
          onClick={onPrevious}
        >
          <Icon name="previous" filled />
        </button>
        <button
          className="play-button"
          aria-label={state.playing ? 'Pause' : 'Play'}
          disabled={disabled || playDisabled}
          onClick={onPlayPause}
        >
          <Icon name={state.playing && !disabled ? 'pause' : 'play'} filled />
        </button>
        <button
          className="icon-button skip-button"
          aria-label="Next song"
          disabled={disabled || nextDisabled}
          onClick={onNext}
        >
          <Icon name="next" filled />
        </button>
      </div>
      <div className="secondary-controls">
        <button
          className={`icon-button mode-button ${state.shuffle ? 'is-active' : ''}`}
          aria-label="Shuffle"
          aria-pressed={state.shuffle}
          disabled={disabled || shuffleDisabled}
          onClick={onShuffle}
        >
          <Icon name="shuffle" />
        </button>
        <div className="volume-control">
          <button
            className="icon-button"
            aria-label={state.muted ? 'Unmute' : 'Mute'}
            aria-pressed={state.muted}
            disabled={disabled || volumeDisabled}
            onClick={onMute}
          >
            <Icon name={state.muted || state.volume === 0 ? 'muted' : 'volume'} />
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            aria-label="Volume"
            aria-valuetext={`${volume}%`}
            disabled={disabled || volumeDisabled}
            style={rangeStyle(volume)}
            onChange={(event) => setVolumeDraft(Number(event.target.value))}
            onPointerUp={commitVolume}
            onKeyUp={commitVolume}
            onBlur={commitVolume}
            onPointerCancel={() => setVolumeDraft(null)}
          />
          <span className="volume-number">{volume}</span>
        </div>
        <button
          className={`icon-button mode-button ${state.repeat !== 'off' ? 'is-active' : ''}`}
          aria-label={`${repeatLabel}. Change repeat mode`}
          aria-pressed={state.repeat !== 'off'}
          disabled={disabled || repeatDisabled}
          onClick={onRepeat}
        >
          <Icon name="repeat" />
          {state.repeat === 'one' && <span className="repeat-one">1</span>}
        </button>
      </div>
      {track?.uri && (
        <button className="spotify-attribution" onClick={onOpenTrack}>
          Listen on Spotify ↗
        </button>
      )}
      <span className="player-footnote">
        made to play on repeat <span>✧</span>
      </span>
    </section>
  )
}
