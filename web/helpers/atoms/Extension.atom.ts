import { atomWithStorage } from 'jotai/utils'

const INACTIVE_ENGINE_PROVIDER = 'inActiveEngineProvider'
export const inActiveEngineProviderAtom = atomWithStorage<string[]>(
  INACTIVE_ENGINE_PROVIDER,
  [],
  undefined,
  { getOnInit: true }
)

const SHOW_SETTING_ACTIVE_LOCAL_ENGINE = 'showSettingActiveLocalEngine'
export const showSettingActiveLocalEngineAtom = atomWithStorage<string[]>(
  SHOW_SETTING_ACTIVE_LOCAL_ENGINE,
  [],
  undefined,
  { getOnInit: true }
)

const SHOW_SETTING_ACTIVE_REMOTE_ENGINE = 'showSettingActiveRemoteEngine'
export const showSettingActiveRemoteEngineAtom = atomWithStorage<string[]>(
  SHOW_SETTING_ACTIVE_REMOTE_ENGINE,
  [],
  undefined,
  { getOnInit: true }
)
