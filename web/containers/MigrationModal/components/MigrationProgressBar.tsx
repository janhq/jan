import { Progress } from '@janhq/joi'

import { formatDownloadPercentage } from '@/utils/converter'

type Props = {
  percentage: number
}

const MigrationProgressBar: React.FC<Props> = ({ percentage }) => {
  return (
    <div className="flex flex-row items-center gap-x-2 pb-1.5">
      <Progress className="inline-block h-1 flex-1" value={percentage} />
      <span className="tabular-nums">
        {formatDownloadPercentage(percentage)}
      </span>
    </div>
  )
}

export default MigrationProgressBar
