import React, { useEffect } from 'react'
import { useState } from 'react'

import { useAtom } from 'jotai'

import { fileUploadAtom } from '@/containers/Providers/Jotai'

import { getBase64 } from '@/utils/base64'

type Props = {
  file: File
}

const ImageUploadPreview: React.FC<Props> = ({ file }) => {
  const [base64, setBase64] = useState<string | undefined>()
  const [fileUpload, setFileUpload] = useAtom(fileUploadAtom)

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
    <div className="flex flex-col">
      <div onClick={onDeleteClick}>Delete</div>
      <img src={base64} alt="" />
    </div>
  )
}

export default React.memo(ImageUploadPreview)
