import { useAtom } from 'jotai'

import { userConfigs } from '@/helpers/JotaiWrapper'

export function useUserConfigs() {
  return useAtom(userConfigs)
}
