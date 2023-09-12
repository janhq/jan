import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";

type Props = {
  title: string;
  expanded: boolean;
  onClick: () => void;
};

const ExpandableHeader: React.FC<Props> = ({ title, expanded, onClick }) => (
  <button onClick={onClick} className="flex items-center justify-between px-2">
    <h2 className="text-gray-400 font-bold text-[12px] leading-[12px] pl-1">
      {title}
    </h2>
    <div className="mr-2">
      {expanded ? (
        <ChevronDownIcon width={12} height={12} color="#6B7280" />
      ) : (
        <ChevronUpIcon width={12} height={12} color="#6B7280" />
      )}
    </div>
  </button>
);

export default ExpandableHeader;
