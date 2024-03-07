import { useEffect, useState } from 'react'

import { Button } from '@janhq/uikit'
import { useAtomValue } from 'jotai'

import { useConvertHuggingFaceModel } from '@/hooks/useConvertHuggingFaceModel'

import {
  conversionStatusAtom,
  repoDataAtom,
} from '@/helpers/atoms/HFConverter.atom'

export const HuggingFaceConvertingModal = () => {
  // This component only loads when repoData is not null
  const repoData = useAtomValue(repoDataAtom)!
  // This component only loads when conversionStatus is not null
  const conversionStatus = useAtomValue(conversionStatusAtom)!
  const [status, setStatus] = useState('')
  const { cancelConvertHuggingFaceModel } = useConvertHuggingFaceModel()

  useEffect(() => {
    switch (conversionStatus) {
      case 'downloading':
        setStatus('Downloading files...')
        break
      case 'converting':
        setStatus('Converting...')
        break
      case 'quantizing':
        setStatus('Quantizing...')
        break
      case 'stopping':
        setStatus('Stopping...')
        break
      case 'generating':
        setStatus('Generating metadata...')
        break
    }
  }, [conversionStatus])

  const onStopClick = () => {
    cancelConvertHuggingFaceModel(repoData.id, repoData)
  }

  return (
    <>
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-2xl font-bold">Hugging Face Converter</p>
      </div>
      {conversionStatus === 'done' ? (
        <div className="flex flex-col items-center justify-center gap-1">
          <p>Done!</p>
          <p>Now you can use the model on Jan as usual. Have fun!</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col items-center justify-center gap-1">
            <p>{status}</p>
          </div>
          <Button
            onClick={onStopClick}
            className="w-full"
            loading={conversionStatus === 'stopping'}
            disabled={conversionStatus === 'stopping'}
            themes="danger"
          >
            {conversionStatus === 'stopping' ? 'Stopping...' : 'Stop'}
          </Button>
        </>
      )}
    </>
  )
}
