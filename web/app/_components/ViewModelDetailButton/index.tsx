import { ChevronDownIcon } from "@heroicons/react/24/outline";

type Props = {
  callback: () => void;
};

const ViewModelDetailButton: React.FC<Props> = ({ callback }) => {
  return (
    <div className="px-4 pb-4">
      <button
        onClick={callback}
        className="bg-gray-100 py-1 px-[10px] w-full flex items-center justify-center gap-1 rounded-lg"
      >
        <span className="text-xs leading-[18px]">View Details</span>
        <ChevronDownIcon width={18} height={18} />
      </button>
    </div>
  );
};

export default ViewModelDetailButton;
