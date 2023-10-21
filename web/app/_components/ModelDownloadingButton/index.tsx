import { toGigabytes } from '@utils/converter'

type Props = {
  total: number
  value: number
}

const ModelDownloadingButton: React.FC<Props> = ({ total, value }) => {
  return (
    <div className="flex flex-col gap-1">
      <button className="flex gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs leading-[18px]">
        Downloading...
      </button>
      <div className="rounded bg-gray-200 px-2.5 py-0.5">
        <span className="text-xs font-medium text-gray-800">
          {toGigabytes(value)} / {toGigabytes(total)}
        </span>
      </div>
    </div>
  )
}

export default ModelDownloadingButton
