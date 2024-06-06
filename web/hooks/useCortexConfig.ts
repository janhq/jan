import { useCallback } from 'react'

import { useSetAtom } from 'jotai'

import useCortex from './useCortex'

import { setCortexConfigAtom } from '@/helpers/atoms/CortexConfig.atom'

const useCortexConfig = () => {
  const { getCortexConfigs } = useCortex()
  const setCortexConfig = useSetAtom(setCortexConfigAtom)

  const getConfig = useCallback(async () => {
    const configs = await getCortexConfigs()
    setCortexConfig(configs)
  }, [getCortexConfigs, setCortexConfig])

  return { getConfig }
}

export default useCortexConfig
