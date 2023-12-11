import { createContext, ReactNode, useEffect, useState } from 'react'

interface FeatureToggleContextType {
  experimentalFeatureEnabed: boolean
  setExperimentalFeatureEnabled: (on: boolean) => void
}

const initialContext: FeatureToggleContextType = {
  experimentalFeatureEnabed: false,
  setExperimentalFeatureEnabled: () => {},
}

export const FeatureToggleContext =
  createContext<FeatureToggleContextType>(initialContext)

export default function FeatureToggleWrapper({
  children,
}: {
  children: ReactNode
}) {
  const EXPERIMENTAL_FEATURE_ENABLED = 'expermientalFeatureEnabled'
  const [experimentalEnabed, setExperimentalEnabled] = useState<boolean>(false)

  useEffect(() => {
    setExperimentalEnabled(
      localStorage.getItem(EXPERIMENTAL_FEATURE_ENABLED) === 'true'
    )
  }, [])

  const setExperimentalFeature = (on: boolean) => {
    localStorage.setItem(EXPERIMENTAL_FEATURE_ENABLED, on ? 'true' : 'false')
    setExperimentalEnabled(on)
  }

  return (
    <FeatureToggleContext.Provider
      value={{
        experimentalFeatureEnabed: experimentalEnabed,
        setExperimentalFeatureEnabled: setExperimentalFeature,
      }}
    >
      {children}
    </FeatureToggleContext.Provider>
  )
}
