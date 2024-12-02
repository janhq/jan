import { memo, useMemo } from 'react'

import { ThreadContent } from '@janhq/core'
import { Tooltip } from '@janhq/joi'

import { FolderOpenIcon } from 'lucide-react'

import { usePath } from '@/hooks/usePath'

import { openFileTitle } from '@/utils/titleUtils'

import { RelativeImage } from '../TextMessage/RelativeImage'

const ImageMessage = ({ content }: { content: ThreadContent }) => {
  const { onViewFile, onViewFileContainer } = usePath()

  const annotation = useMemo(
    () => content?.text?.annotations[0] ?? '',
    [content]
  )

  return (
    <div className="group/image relative mb-2 inline-flex cursor-pointer overflow-hidden rounded-xl">
      <div className="left-0 top-0 z-20 h-full w-full group-hover/image:inline-block">
        <RelativeImage
          src={annotation}
          onClick={() => onViewFile(annotation)}
        />
      </div>
      <Tooltip
        trigger={
          <div
            className="absolute right-2 top-2 z-20 hidden h-8 w-8 cursor-pointer items-center justify-center rounded-md bg-[hsla(var(--app-bg))] group-hover/image:flex"
            onClick={onViewFileContainer}
          >
            <FolderOpenIcon size={20} />
          </div>
        }
        content={<span>{openFileTitle()}</span>}
      />
    </div>
  )
}

export default memo(ImageMessage)
