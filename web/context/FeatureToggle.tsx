import { createContext, ReactNode, useEffect, useState } from 'react'

interface FeatureToggleContextType {
  experimentalFeature: boolean
  ignoreSSL: boolean
  proxy: string
  proxyEnabled: boolean
  vulkanEnabled: boolean
  setExperimentalFeature: (on: boolean) => void
  setVulkanEnabled: (on: boolean) => void
  setIgnoreSSL: (on: boolean) => void
  setProxy: (value: string) => void
  setProxyEnabled: (on: boolean) => void
}

const initialContext: FeatureToggleContextType = {
  experimentalFeature: false,
  ignoreSSL: false,
  proxy: '',
  proxyEnabled: false,
  vulkanEnabled: false,
  setExperimentalFeature: () => {},
  setVulkanEnabled: () => {},
  setIgnoreSSL: () => {},
  setProxy: () => {},
  setProxyEnabled: () => {},
}

export const FeatureToggleContext =
  createContext<FeatureToggleContextType>(initialContext)

export default function FeatureToggleWrapper({
  children,
}: {
  children: ReactNode
}) {
  const EXPERIMENTAL_FEATURE = 'experimentalFeature'
  const VULKAN_ENABLED = 'vulkanEnabled'
  const IGNORE_SSL = 'ignoreSSLFeature'
  const HTTPS_PROXY_FEATURE = 'httpsProxyFeature'
  const PROXY_FEATURE_ENABLED = 'proxyFeatureEnabled'

  const [experimentalFeature, directSetExperimentalFeature] =
    useState<boolean>(false)
  const [proxyEnabled, directSetProxyEnabled] = useState<boolean>(false)
  const [vulkanEnabled, directEnableVulkan] = useState<boolean>(false)
  const [ignoreSSL, directSetIgnoreSSL] = useState<boolean>(false)
  const [proxy, directSetProxy] = useState<string>('')

  useEffect(() => {
    directSetExperimentalFeature(
      localStorage.getItem(EXPERIMENTAL_FEATURE) === 'true'
    )
    directSetIgnoreSSL(localStorage.getItem(IGNORE_SSL) === 'true')
    directSetProxy(localStorage.getItem(HTTPS_PROXY_FEATURE) ?? '')
    directSetProxyEnabled(
      localStorage.getItem(PROXY_FEATURE_ENABLED) === 'true'
    )
  }, [])

  const setExperimentalFeature = (on: boolean) => {
    localStorage.setItem(EXPERIMENTAL_FEATURE, on ? 'true' : 'false')
    directSetExperimentalFeature(on)
  }

  const setVulkanEnabled = (on: boolean) => {
    localStorage.setItem(VULKAN_ENABLED, on ? 'true' : 'false')
    directEnableVulkan(on)
  }

  const setIgnoreSSL = (on: boolean) => {
    localStorage.setItem(IGNORE_SSL, on ? 'true' : 'false')
    directSetIgnoreSSL(on)
  }

  const setProxy = (proxy: string) => {
    localStorage.setItem(HTTPS_PROXY_FEATURE, proxy)
    directSetProxy(proxy)
  }

  const setProxyEnabled = (on: boolean) => {
    localStorage.setItem(PROXY_FEATURE_ENABLED, on ? 'true' : 'false')
    directSetProxyEnabled(on)
  }

  return (
    <FeatureToggleContext.Provider
      value={{
        experimentalFeature,
        ignoreSSL,
        proxy,
        proxyEnabled,
        vulkanEnabled,
        setExperimentalFeature,
        setVulkanEnabled,
        setIgnoreSSL,
        setProxy,
        setProxyEnabled,
      }}
    >
      {children}
    </FeatureToggleContext.Provider>
  )
}
