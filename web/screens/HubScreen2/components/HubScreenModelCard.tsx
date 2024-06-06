import { useMemo, useCallback } from 'react'

import { Button } from '@janhq/joi'
import { useSetAtom } from 'jotai'
import { CloudDownload } from 'lucide-react'

import { HfModelEntry } from '@/utils/huggingface'

import { addThousandSeparator } from '@/utils/number'

import ModelTitle from './ModelTitle'

import { localModelModalStageAtom } from '@/helpers/atoms/DownloadLocalModel.atom'

const HubScreenModelCard: React.FC<HfModelEntry> = ({
  name,
  downloads,
  model,
}) => {
  const setLocalModelModalStage = useSetAtom(localModelModalStageAtom)

  const actionLabel = useMemo(() => {
    return 'Download'
  }, [])

  const onActionClick = useCallback(() => {
    setLocalModelModalStage('MODEL_LIST', name)
  }, [setLocalModelModalStage, name])

  const owner = model?.metadata?.owned_by ?? ''
  const logoUrl = model?.metadata?.owner_logo ?? ''

  return (
    <div
      className="flex cursor-pointer flex-row justify-between border-b-[1px] border-[hsla(var(--app-border))] pb-3 pt-4 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
      onClick={onActionClick}
    >
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium leading-4">{name}</span>
        <ModelTitle
          className="text-[hsla(var(--text-secondary)]"
          name={owner}
          image={logoUrl}
        />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Button
          className="!bg-[#0000000F] text-[var(--text-primary)]"
          onClick={onActionClick}
        >
          {actionLabel}
        </Button>
        <span className="flex items-center gap-1 text-sm font-medium leading-3">
          {addThousandSeparator(downloads)}
          <CloudDownload size={14} />
        </span>
      </div>
    </div>
  )
}

export default HubScreenModelCard
