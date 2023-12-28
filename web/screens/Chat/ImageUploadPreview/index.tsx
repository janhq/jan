import React, { useEffect } from 'react'
import { useState } from 'react'

import { getBase64 } from '@/utils/base64'

type Props = {
  file: File
}

const ImageUploadPreview: React.FC<Props> = ({ file }) => {
  const [base64, setBase64] = useState<string | undefined>()

  useEffect(() => {
    getBase64(file)
      .then((base64) => setBase64(base64))
      .catch((err) => console.error(err))
  }, [file])

  if (!base64) {
    return <div>Loading..</div>
  }

  return <img src={base64} alt="" />
}

export default React.memo(ImageUploadPreview)
