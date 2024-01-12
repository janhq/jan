import { createContext, ReactNode, useEffect, useState } from 'react'

interface FeatureToggleContextType {
  experimentalFeature: boolean
  ignoreSSL: boolean
  setExperimentalFeature: (on: boolean) => void
  setIgnoreSSL: (on: boolean) => void
}

const initialContext: FeatureToggleContextType = {
  experimentalFeature: false,
  ignoreSSL: false,
  setExperimentalFeature: () => {},
  setIgnoreSSL: () => {},
}

export const FeatureToggleContext =
  createContext<FeatureToggleContextType>(initialContext)

export default function FeatureToggleWrapper({
  children,
}: {
  children: ReactNode
}) {
  const EXPERIMENTAL_FEATURE = 'expermientalFeature'
  const IGNORE_SSL = 'ignoreSSLFeature'
  const [experimentalFeature, directSetExperimentalFeature] = useState<boolean>(false)
  const [ignoreSSL, directSetIgnoreSSL] = useState<boolean>(false)

  useEffect(() => {
    directSetExperimentalFeature(
      localStorage.getItem(EXPERIMENTAL_FEATURE) === 'true'
    )
    directSetIgnoreSSL(
      localStorage.getItem(IGNORE_SSL) === 'true'
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

  return (
    <FeatureToggleContext.Provider
      value={{
        experimentalFeature,
        ignoreSSL, 
        setExperimentalFeature,
        setIgnoreSSL,
      }}
    >
      {children}
    </FeatureToggleContext.Provider>
  )
}
