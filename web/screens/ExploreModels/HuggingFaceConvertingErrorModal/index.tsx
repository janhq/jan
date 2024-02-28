import { useAtomValue } from 'jotai'

import {
  conversionStatusAtom,
  repoDataAtom,
} from '@/helpers/atoms/HFConverter.atom'

export const HuggingFaceConvertingErrorModal = () => {
  // This component only loads when repoData is not null
  const repoData = useAtomValue(repoDataAtom)!
  // This component only loads when conversionStatus is not null
  const conversionStatus = useAtomValue(conversionStatusAtom)!

  return (
    <>
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-2xl font-bold">Hugging Face Converter</p>
      </div>
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-center">
          An error occured while {conversionStatus} model {repoData.id}.
        </p>
        <p>Please close this modal and try again.</p>
      </div>
    </>
  )
}
