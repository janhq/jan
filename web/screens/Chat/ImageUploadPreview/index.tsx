import React, { useEffect } from 'react'
import { useState } from 'react'

import { useSetAtom } from 'jotai'

import { XIcon } from 'lucide-react'

import { fileUploadAtom } from '@/containers/Providers/Jotai'

import { getBase64 } from '@/utils/base64'

type Props = {
  file: File
}

const ImageUploadPreview: React.FC<Props> = ({ file }) => {
  const [base64, setBase64] = useState<string | undefined>()
  const setFileUpload = useSetAtom(fileUploadAtom)

  useEffect(() => {
    getBase64(file)
      .then((base64) => setBase64(base64))
      .catch((err) => console.error(err))
  }, [file])

  if (!base64) {
    return <div>Loading..</div>
  }

  const onDeleteClick = () => {
    setFileUpload([])
  }

  return (
    // <div className="flex flex-col">
    //   <div onClick={onDeleteClick}>Delete</div>
    //   <img src={base64} alt="" />
    // </div>
    <div className="flex flex-col rounded-t-lg border border-b-0 border-border p-4">
      <div className="relative w-60 rounded-lg bg-secondary p-4">
        {/* <Icon type={fileUpload[0].type} /> */}
        <img src={base64} alt={file.name} className="object-cover" />
        <h6 className="mt-2 font-medium">{file.name}</h6>
        <div
          className="absolute -right-2 -top-2 cursor-pointer rounded-full bg-foreground p-0.5"
          onClick={onDeleteClick}
        >
          <XIcon size={14} className="text-background" />
        </div>
      </div>
    </div>
  )
}

export default React.memo(ImageUploadPreview)
