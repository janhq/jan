import { useAtomValue, useSetAtom } from 'jotai'

import {
  repoDataAtom,
  repoIDAtom,
  loadingAtom,
  fetchErrorAtom,
} from '@/helpers/atoms/HFConverter.atom'

export const useGetHFRepoData = () => {
  const repoID = useAtomValue(repoIDAtom)
  const setRepoData = useSetAtom(repoDataAtom)
  const setLoading = useSetAtom(loadingAtom)
  const setFetchError = useSetAtom(fetchErrorAtom)

  const getRepoData = async () => {
    setLoading(true)
    try {
      const res = await fetch(`https://huggingface.co/api/models/${repoID}`)
      const data = await res.json()
      setRepoData(data)
    } catch (err) {
      setFetchError(err as Error)
    }
    setLoading(false)
  }

  return getRepoData
}
