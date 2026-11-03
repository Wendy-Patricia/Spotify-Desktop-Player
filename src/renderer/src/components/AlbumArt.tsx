import { useState } from 'react'
import type { Track } from '../data/playlist'

export default function AlbumArt({
  track,
  small = false
}: {
  track: Track
  small?: boolean
}): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState('')
  if (track.imageUrl && track.imageUrl !== failedUrl) {
    return (
      <img
        className={`album-art album-image ${small ? 'art-small' : ''}`}
        src={track.imageUrl}
        alt={`Album cover for ${track.album}`}
        onError={() => setFailedUrl(track.imageUrl!)}
      />
    )
  }
  return (
    <div
      className={`album-art art-${track.color} ${small ? 'art-small' : ''}`}
      role="img"
      aria-label={`Illustrative album cover for ${track.album}`}
    >
      <span className="art-orbit orbit-one" />
      <span className="art-orbit orbit-two" />
      <span className="art-spark spark-one">✧</span>
      <span className="art-spark spark-two">✦</span>
      <span className="art-label">{track.artist}</span>
      {track.motif === 'bunny' ? (
        <svg className="art-character" viewBox="0 0 240 280" aria-hidden="true">
          <path
            d="M76 143C34 71 44 8 69 15c19 5 29 63 33 105 5-57 21-108 42-100 23 9 12 76-2 113 53 11 75 53 53 93-17 32-103 41-139 7-27-27-18-72 20-90Z"
            fill="#f6f0fb"
            stroke="#353065"
            strokeWidth="3"
          />
          <ellipse cx="89" cy="181" rx="5" ry="9" fill="#353065" />
          <ellipse cx="139" cy="181" rx="5" ry="9" fill="#353065" />
          <path
            d="m106 198 8 6 8-6M114 204v7"
            fill="none"
            stroke="#353065"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <ellipse cx="71" cy="201" rx="13" ry="6" fill="#efa3cc" />
          <ellipse cx="158" cy="201" rx="13" ry="6" fill="#efa3cc" />
          <path
            d="m165 123 6-16 7 16 17 6-17 6-7 16-6-16-17-6Z"
            fill="#f69fc7"
            stroke="#353065"
            strokeWidth="2"
          />
        </svg>
      ) : (
        <span className={`art-symbol symbol-${track.motif}`}>
          {track.motif === 'star' ? '✦' : '✿'}
        </span>
      )}
      <span className="art-wordmark">{track.album || track.title}</span>
      <span className="art-edition">ALBUM ART UNAVAILABLE</span>
    </div>
  )
}
