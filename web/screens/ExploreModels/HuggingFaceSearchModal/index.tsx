import { Button, Input } from '@janhq/uikit'
import { useSetAtom, useAtomValue } from 'jotai'

import { useGetHFRepoData } from '@/hooks/useGetHFRepoData'

import { repoIDAtom, loadingAtom } from '@/helpers/atoms/HFConverter.atom'

export const HuggingFaceSearchModal = () => {
  const setRepoID = useSetAtom(repoIDAtom)
  const loading = useAtomValue(loadingAtom)

  const getRepoData = useGetHFRepoData()

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      getRepoData()
    }
  }

  return (
    <>
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-2xl font-bold">Hugging Face Convertor</p>
        <p className="text-gray-500">Type the repository id below</p>
      </div>
      <Input
        placeholder="e.g. username/repo-name"
        className="bg-white"
        onChange={(e) => {
          setRepoID(e.target.value)
        }}
        onKeyDown={onKeyDown}
      />
      <Button
        onClick={getRepoData}
        className="w-full"
        loading={loading}
        themes={loading ? 'ghost' : 'primary'}
      >
        {loading ? '' : 'OK'}
      </Button>
    </>
  )
}
