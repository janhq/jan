import { useAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export const userConfigs = atomWithStorage<UserConfig>('config', {
  gettingStartedShow: true,
  primaryColor: 'primary-yellow',
})

export function useUserConfigs() {
  return useAtom(userConfigs)
}
