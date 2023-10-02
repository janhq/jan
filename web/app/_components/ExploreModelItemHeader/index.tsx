import { toGigabytes } from "@/_utils/converter";
import SimpleTag, { TagType } from "../SimpleTag";

type Props = {
  name: string;
  total: number;
  status: TagType;
};

const ExploreModelItemHeader: React.FC<Props> = ({ name, status, total }) => (
  <div className="flex items-center justify-between p-4 border-b border-gray-200">
    <div className="flex items-center gap-2">
      <span>{name}</span>
      <SimpleTag title={status} type={status} clickable={false} />
    </div>
    <button className="px-[17px] py-[9px] w-[239px] h-[36px] rounded-md bg-blue-500 text-sm text-white font-medium hover:bg-blue-600">
      Download ({toGigabytes(total)})
    </button>
  </div>
);

export default ExploreModelItemHeader;
