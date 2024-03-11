import { useEffect } from 'react'

import { AppConfiguration } from '@janhq/core/.'
import { useSetAtom } from 'jotai'

import { appConfigurationAtom } from '@/helpers/atoms/AppConfig.atom'

export default function useAppConfig() {
  const setAppConfiguration = useSetAtom(appConfigurationAtom)

  useEffect(() => {
    window.core?.api
      ?.getAppConfigurations()
      ?.then((appConfig: AppConfiguration) => {
        setAppConfiguration(appConfig)
      })
  }, [setAppConfiguration])
}
