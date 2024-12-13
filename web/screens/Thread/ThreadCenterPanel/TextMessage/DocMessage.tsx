import { memo } from 'react'

import { Tooltip } from '@janhq/joi'

import { FolderOpenIcon } from 'lucide-react'

import { usePath } from '@/hooks/usePath'

import { toGibibytes } from '@/utils/converter'
import { openFileTitle } from '@/utils/titleUtils'

import Icon from '../FileUploadPreview/Icon'

const DocMessage = ({ id, name }: { id: string; name?: string }) => {
  const { onViewFile, onViewFileContainer } = usePath()

  return (
    <div className="group/file bg-secondary relative mb-2 inline-flex w-60 cursor-pointer gap-x-3 overflow-hidden rounded-lg p-4">
      <div
        className="absolute left-0 top-0 z-20 hidden h-full w-full bg-black/20 backdrop-blur-sm group-hover/file:inline-block"
        onClick={() => onViewFile(`${id}.pdf`)}
      />
      <Tooltip
        trigger={
          <div
            className="absolute right-2 top-2 z-20 hidden h-8 w-8 cursor-pointer items-center justify-center rounded-md bg-[hsla(var(--app-bg))] group-hover/file:flex"
            onClick={onViewFileContainer}
          >
            <FolderOpenIcon size={20} />
          </div>
        }
        content={<span>{openFileTitle()}</span>}
      />
      <Icon type="pdf" />
      <div className="w-full">
        <h6 className="line-clamp-1 w-4/5 font-medium">
          {name?.replaceAll(/[-._]/g, ' ')}
        </h6>
        {/* <p className="text-[hsla(var(--text-secondary)]">
          {toGibibytes(Number(size))}
        </p> */}
      </div>
    </div>
  )
}

export default memo(DocMessage)
