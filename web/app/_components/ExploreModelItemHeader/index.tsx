import { toGigabytes } from "@/_utils/converter";

type Props = {
  name: string;
  total: number;
  status: string;
};

function classNames(...classes: any) {
  return classes.filter(Boolean).join(" ");
}

const ExploreModelItemHeader: React.FC<Props> = ({ name, status, total }) => {
  const statuses: { [key: string]: string } = {
    Recommended:
      "text-green-700 ring-1 ring-inset ring-green-600/20 bg-green-50",
    "This model will be slow on your device":
      "bg-yellow-50 text-yellow-800 ring-1 ring-inset ring-yellow-600/20",
    "Incompatible with your device":
      "bg-red-50 ext-red-700 ring-1 ring-inset ring-red-600/10",
    "This model is too large for your device":
      "bg-red-50 ext-red-700 ring-1 ring-inset ring-red-600/10",
  };
  return (
    <div className="flex items-center justify-between p-4 border-b border-gray-200">
      <div className="flex items-center gap-2">
        <span>{name}</span>
        <p
          className={classNames(
            statuses[status],
            "rounded-md whitespace-nowrap px-[10px] py-0.5 text-xs font-medium ring-1 ring-inset"
          )}
        >
          {status}
        </p>
      </div>
      <button className="px-[17px] py-[9px] w-[239px] h-[36px] rounded-md bg-blue-500 text-sm text-white font-medium hover:bg-blue-600">
        Download ({toGigabytes(total)})
      </button>
    </div>
  );
};

export default ExploreModelItemHeader;
