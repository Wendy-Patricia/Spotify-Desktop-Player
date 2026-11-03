import { useEffect, useState } from 'react'
import type { AppVersions } from '../../../shared/api'

function Versions(): React.JSX.Element {
  const [versions, setVersions] = useState<AppVersions | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    window.api.getVersions().then(
      (result) => {
        if (active) setVersions(result)
      },
      () => {
        if (active) setError(true)
      }
    )
    return () => {
      active = false
    }
  }, [])

  if (error) return <p role="alert">Unable to load Electron versions.</p>
  if (!versions) return <p role="status">Loading versions…</p>

  return (
    <ul className="versions">
      <li className="electron-version">Electron v{versions.electron}</li>
      <li className="chrome-version">Chromium v{versions.chrome}</li>
      <li className="node-version">Node v{versions.node}</li>
    </ul>
  )
}

export default Versions
