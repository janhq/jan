import { memo, useEffect, useState } from 'react'

import { usePath } from '@/hooks/usePath'

import { getFileInfo } from '@/utils/file'

import Icon from '../FileUploadPreview/Icon'

const DocMessage = ({ id }: { id: string }) => {
  const { onViewFile } = usePath()
  const [fileInfo, setFileInfo] = useState<
    { filename: string; id: string } | undefined
  >()
  useEffect(() => {
    if (!fileInfo) {
      getFileInfo(id).then((data) => {
        setFileInfo(data)
      })
    }
  }, [fileInfo, id])

  return (
    <div className="group/file bg-secondary relative mb-2 inline-flex w-60 cursor-pointer gap-x-3 overflow-hidden rounded-lg p-4">
      <div
        className="absolute left-0 top-0 z-20 hidden h-full w-full bg-black/20 opacity-50 group-hover/file:inline-block"
        onClick={() => onViewFile(`${id}.pdf`)}
      />

      <Icon type="pdf" />
      <div className="w-full">
        <h6 className="line-clamp-1 w-4/5 overflow-hidden font-medium">
          {fileInfo?.filename}
        </h6>
        <p className="text-[hsla(var(--text-secondary)] line-clamp-1 overflow-hidden truncate">
          {fileInfo?.id ?? id}
        </p>
      </div>
    </div>
  )
}

export default memo(DocMessage)
