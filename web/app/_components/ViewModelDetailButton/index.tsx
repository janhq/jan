import { ChevronDownIcon } from '@heroicons/react/24/outline'

type Props = {
  callback: () => void
}

const ViewModelDetailButton: React.FC<Props> = ({ callback }) => {
  return (
    <div className="px-4 pb-4">
      <button
        onClick={callback}
        className="flex w-full items-center justify-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1"
      >
        <span className="text-xs leading-[18px]">View Details</span>
        <ChevronDownIcon width={18} height={18} />
      </button>
    </div>
  )
}

export default ViewModelDetailButton
