import { useEffect, useState } from 'react'

export function useGetAppVersion() {
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    getAppVersion()
  }, [])

  const getAppVersion = () => {
    window.core.api?.appVersion().then((version: string | undefined) => {
      setVersion(version ?? '')
    })
  }

  return { version }
}
