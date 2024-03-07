import { atomWithStorage } from 'jotai/utils'

export const hostOptions = ['127.0.0.1', '0.0.0.0']

export const apiServerPortAtom = atomWithStorage('apiServerPort', '1337')
export const apiServerHostAtom = atomWithStorage('apiServerHost', '127.0.0.1')

export const apiServerCorsEnabledAtom = atomWithStorage(
  'apiServerCorsEnabled',
  true
)

export const apiServerVerboseLogEnabledAtom = atomWithStorage(
  'apiServerVerboseLogEnabled',
  true
)
