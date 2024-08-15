import { atomWithStorage } from 'jotai/utils'

export const hostOptions = [
  { name: '127.0.0.1', value: '127.0.0.1' },
  { name: '0.0.0.0', value: '0.0.0.0' },
]

export const apiServerPortAtom = atomWithStorage('apiServerPort', '1337')
export const apiServerHostAtom = atomWithStorage('apiServerHost', '127.0.0.1')
export const apiServerPrefix = atomWithStorage('apiServerPrefix', '/v1')

export const apiServerCorsEnabledAtom = atomWithStorage(
  'apiServerCorsEnabled',
  true
)

export const apiServerVerboseLogEnabledAtom = atomWithStorage(
  'apiServerVerboseLogEnabled',
  true
)
