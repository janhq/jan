import React, { useEffect } from 'react'
import { useState } from 'react'

import { useSetAtom } from 'jotai'

import { XIcon } from 'lucide-react'

import { currentPromptAtom, fileUploadAtom } from '@/containers/Providers/Jotai'

import { getBase64 } from '@/utils/base64'

type Props = {
  file: File
}

const ImageUploadPreview: React.FC<Props> = ({ file }) => {
  const [base64, setBase64] = useState<string | undefined>()
  const setFileUpload = useSetAtom(fileUploadAtom)
  const setCurrentPrompt = useSetAtom(currentPromptAtom)

  useEffect(() => {
    getBase64(file)
      .then((base64) => setBase64(base64))
      .catch((err) => console.error(err))
  }, [file])

  if (!base64) {
    return
  }

  const onDeleteClick = () => {
    setFileUpload(undefined)
    setCurrentPrompt('')
  }

  return (
    <div className="flex flex-col rounded-t-lg border border-b-0 border-[hsla(var(--app-border))] p-4">
      <div className="relative w-40 overflow-hidden rounded-lg border border-[hsla(var(--app-border))]">
        <img src={base64} alt={file.name} className="object-cover" />
        <div
          className="absolute right-2 top-2 cursor-pointer rounded-full bg-[hsla(var(--destructive-bg))] p-0.5 text-[hsla(var(--destructive-fg))]"
          onClick={onDeleteClick}
        >
          <XIcon size={14} className="text-background" />
        </div>
      </div>
    </div>
  )
}

export default React.memo(ImageUploadPreview)
