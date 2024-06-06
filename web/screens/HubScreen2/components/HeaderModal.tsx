import Image from 'next/image'

import { Button } from '@janhq/joi'
import { ChevronsLeftRight } from 'lucide-react'

type Props = {
  name: string
  onCortexButtonClick: () => void
  onActionClick: () => void
}

const HeaderModal: React.FC<Props> = ({
  name,
  onCortexButtonClick,
  onActionClick,
}) => {
  return (
    <div className="flex items-center">
      <span className="text-xl font-semibold leading-8">{name}</span>
      <div
        className="ml-auto mr-3 flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-4 py-2"
        onClick={onCortexButtonClick}
      >
        <Image
          width={22.5}
          height={18}
          src="/icons/ic_cortex.svg"
          alt="Cortex icon"
        />
        <span className="text-[16.2px] font-bold leading-[9px]">Cotex</span>
        <ChevronsLeftRight size={16} color="#00000099" />
      </div>
      <Button
        className="mr-6 px-4 py-2"
        onClick={onActionClick}
        variant="solid"
      >
        <span className="text-sm font-semibold">Set Up</span>
      </Button>
    </div>
  )
}
export default HeaderModal
