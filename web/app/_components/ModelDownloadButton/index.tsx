import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'

type Props = {
  callback: () => void
}

const ModelDownloadButton: React.FC<Props> = ({ callback }) => {
  return (
    <button
      className="flex items-center gap-2 rounded-lg bg-[#1A56DB] px-3 py-2"
      onClick={callback}
    >
      <ArrowDownTrayIcon width={16} height={16} color="#FFFFFF" />
      <span className="text-xs font-medium leading-[18px] text-[#fff]">
        Download
      </span>
    </button>
  )
}

export default ModelDownloadButton
