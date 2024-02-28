import { Button } from '@janhq/uikit'
import { useAtomValue } from 'jotai'

import { useGetHFRepoData } from '@/hooks/useGetHFRepoData'

import { fetchErrorAtom, loadingAtom } from '@/helpers/atoms/HFConverter.atom'

export const HuggingFaceSearchErrorModal = () => {
  // This component only loads when fetchError is not null
  const fetchError = useAtomValue(fetchErrorAtom)!
  const loading = useAtomValue(loadingAtom)

  const getRepoData = useGetHFRepoData()

  return (
    <>
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-2xl font-bold">Error!</p>
        <p className="text-gray-500">Fetch error</p>
      </div>
      <p>{fetchError.message}</p>
      <Button
        onClick={getRepoData}
        className="w-full"
        loading={loading}
        themes={loading ? 'ghost' : 'danger'}
      >
        {loading ? '' : 'Try Again'}
      </Button>
    </>
  )
}
