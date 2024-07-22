import { atom } from 'jotai'

import { ModelFilter } from '@/screens/HubScreen2'

export const hubFilterAtom = atom<ModelFilter>('All')
