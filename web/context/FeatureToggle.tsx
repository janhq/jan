import { createContext, ReactNode, useEffect, useState } from 'react'

interface FeatureToggleContextType {
  experimentalFeature: boolean
  ignoreSSL: boolean
  proxy: string
  setExperimentalFeature: (on: boolean) => void
  setIgnoreSSL: (on: boolean) => void
  setProxy: (value: string) => void
}

const initialContext: FeatureToggleContextType = {
  experimentalFeature: false,
  ignoreSSL: false,
  proxy: '',
  setExperimentalFeature: () => {},
  setIgnoreSSL: () => {},
  setProxy: () => {},
}

export const FeatureToggleContext =
  createContext<FeatureToggleContextType>(initialContext)

export default function FeatureToggleWrapper({
  children,
}: {
  children: ReactNode
}) {
  const EXPERIMENTAL_FEATURE = 'experimentalFeature'
  const IGNORE_SSL = 'ignoreSSLFeature'
  const HTTPS_PROXY_FEATURE = 'httpsProxyFeature'
  const [experimentalFeature, directSetExperimentalFeature] = useState<boolean>(false)
  const [ignoreSSL, directSetIgnoreSSL] = useState<boolean>(false)
  const [proxy, directSetProxy] = useState<string>('')

  useEffect(() => {
    directSetExperimentalFeature(
      localStorage.getItem(EXPERIMENTAL_FEATURE) === 'true'
    )
    directSetIgnoreSSL(
      localStorage.getItem(IGNORE_SSL) === 'true'
    )
    directSetProxy(
      localStorage.getItem(HTTPS_PROXY_FEATURE) ?? ""
    )
  }, [])

  const setExperimentalFeature = (on: boolean) => {
    localStorage.setItem(EXPERIMENTAL_FEATURE, on ? 'true' : 'false')
    directSetExperimentalFeature(on)
  }

  const setIgnoreSSL = (on: boolean) => {
    localStorage.setItem(IGNORE_SSL, on ? 'true' : 'false')
    directSetIgnoreSSL(on)
  }

  const setProxy = (proxy: string) => {
    localStorage.setItem(HTTPS_PROXY_FEATURE, proxy)
    directSetProxy(proxy)
  }

  return (
    <FeatureToggleContext.Provider
      value={{
        experimentalFeature,
        ignoreSSL,
        proxy,
        setExperimentalFeature,
        setIgnoreSSL,
        setProxy,
      }}
    >
      {children}
    </FeatureToggleContext.Provider>
  )
}
