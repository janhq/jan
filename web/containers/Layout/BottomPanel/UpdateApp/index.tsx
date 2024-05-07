import Image from 'next/image'

import { Progress } from '@janhq/joi'

type Props = {
  total: number
  used: number
}

const UpdateApp = ({ used, total }: Props) => (
  <div className="flex items-center gap-2">
    <div className="flex items-center gap-1 font-medium text-[hsla(var(--text-secondary))]">
      <Image src={'icons/app_icon.svg'} width={20} height={20} alt="" />
      Updating App
    </div>
    <Progress
      size="small"
      className="w-20"
      value={Number(`${((used / total) * 100).toFixed(2)}`)}
    />
    <div className="text-xs font-semibold text-[hsla(var(--primary-bg))]">
      {((used / total) * 100).toFixed(0)}%
    </div>
  </div>
)

export default UpdateApp
