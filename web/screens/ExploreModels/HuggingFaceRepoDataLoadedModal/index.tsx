import { Button } from '@janhq/uikit'
import { useAtomValue } from 'jotai'

import {
  loadingAtom,
  repoDataAtom,
  unsupportedAtom,
} from '@/helpers/atoms/HFConverter.atom'

export const HuggingFaceRepoDataLoadedModal = () => {
  const loading = useAtomValue(loadingAtom)
  // This component only loads when repoData is not null
  const repoData = useAtomValue(repoDataAtom)!
  const unsupported = useAtomValue(unsupportedAtom)

  return (
    <>
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-2xl font-bold">Hugging Face Converter</p>
        <p className="text-gray-500">Found the repository!</p>
      </div>
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="font-bold">{repoData.id}</p>
        <p>
          {unsupported
            ? '❌ This model is not supported!'
            : '✅ This model is supported!'}
        </p>
        {repoData.tags.includes('gguf') ? (
          <p>...But you can import it manually!</p>
        ) : null}
      </div>
      <Button
        // onClick={}
        className="w-full"
        loading={loading}
        disabled={unsupported}
        themes={loading ? 'ghost' : 'primary'}
      >
        {loading ? '' : 'Convert'}
      </Button>
    </>
  )
}
