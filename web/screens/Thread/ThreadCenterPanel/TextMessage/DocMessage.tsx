import { memo } from 'react'

import { usePath } from '@/hooks/usePath'

import { toGigabytes } from '@/utils/converter'

import Icon from '../FileUploadPreview/Icon'

const DocMessage = ({
  id,
  metadata,
}: {
  id: string
  metadata: Record<string, unknown> | undefined
}) => {
  const { onViewFile } = usePath()

  return (
    <div className="group/file relative mb-2 inline-flex w-60 cursor-pointer gap-x-3 overflow-hidden rounded-lg bg-[hsla(var(--secondary-bg))] p-4">
      <div
        className="absolute left-0 top-0 z-20 hidden h-full w-full bg-black/20 opacity-50 group-hover/file:inline-block"
        onClick={() => onViewFile(`${id}.pdf`)}
      />

      <Icon type="pdf" />
      <div className="w-full">
        <h6 className="line-clamp-1 w-4/5 overflow-hidden font-medium">
          {metadata && 'filename' in metadata
            ? (metadata.filename as string)
            : id}
        </h6>
        <p className="text-[hsla(var(--text-secondary)] line-clamp-1 overflow-hidden truncate">
          {metadata && 'size' in metadata
            ? toGigabytes(Number(metadata.size))
            : id}
        </p>
      </div>
    </div>
  )
}

export default memo(DocMessage)
