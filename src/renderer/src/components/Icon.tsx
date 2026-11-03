export type IconName =
  | 'play'
  | 'pause'
  | 'previous'
  | 'next'
  | 'heart'
  | 'list'
  | 'shuffle'
  | 'repeat'
  | 'volume'
  | 'muted'
  | 'search'
  | 'close'
  | 'refresh'
  | 'settings'
  | 'music'

const paths: Record<IconName, string> = {
  play: 'M8 4 21 12 8 20Z',
  pause: 'M7 4h3v16H7zM15 4h3v16h-3z',
  previous: 'M5 5v14M20 5 8 12l12 7Z',
  next: 'M19 5v14M4 5l12 7-12 7Z',
  heart:
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  shuffle: 'M3 5h3c5 0 7 14 12 14h3M17 15l4 4-4 4M3 19h3c2 0 4-3 6-7s4-7 6-7h3M17 1l4 4-4 4',
  repeat: 'M4 10V7a3 3 0 0 1 3-3h13M17 1l3 3-3 3M20 14v3a3 3 0 0 1-3 3H4M7 17l-3 3 3 3',
  volume: 'M3 9h4l5-5v16l-5-5H3ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14',
  muted: 'M3 9h4l5-5v16l-5-5H3ZM17 9l5 6M22 9l-5 6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  close: 'm6 6 12 12M18 6 6 18',
  refresh: 'M20 7a9 9 0 1 0 1 8M20 2v6h-6',
  settings: 'M4 7h16M4 17h16M9 4v6M16 14v6',
  music:
    'M9 18V5l12-2v13M9 8l12-2M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3M21 16a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3'
}

export default function Icon({
  name,
  filled = false
}: {
  name: IconName
  filled?: boolean
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
