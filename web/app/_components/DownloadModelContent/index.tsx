import DownloadModelTitle from "../DownloadModelTitle";

type Props = {
  author: string;
  description: string;
  isRecommend: boolean;
  name: string;
  type: string;
  required?: string;
};

const DownloadModelContent: React.FC<Props> = ({
  author,
  description,
  isRecommend,
  name,
  required,
  type,
}) => {
  return (
    <div className="w-4/5 flex flex-col gap-2.5">
      <div className="flex items-center gap-1">
        <h2 className="font-medium text-xl leading-[25px] tracking-[-0.4px] text-gray-900">
          {name}
        </h2>
        <DownloadModelTitle title={type} />
        <div className="py-0.5 px-2.5 bg-purple-100 rounded-md text-center">
          <span className="text-xs leading-[18px] font-semibold text-purple-800">
            {author}
          </span>
        </div>
        {required && (
          <div className="py-0.5 px-2.5 bg-purple-100 rounded-md text-center">
            <span className="text-xs leading-[18px] text-[#11192899]">
              Required{" "}
            </span>
            <span className="text-xs leading-[18px] font-semibold text-gray-900">
              {required}
            </span>
          </div>
        )}
      </div>
      <p className="text-xs leading-[18px] text-gray-500">{description}</p>
      <div
        className={`${
          isRecommend ? "flex" : "hidden"
        } w-fit justify-center items-center bg-green-50 rounded-full px-2.5 py-0.5 gap-2`}
      >
        <div className="w-3 h-3 rounded-full bg-green-400"></div>
        <span className="text-green-600 font-medium text-xs leading-18px">
          Recommend
        </span>
      </div>
    </div>
  );
};

export default DownloadModelContent;
