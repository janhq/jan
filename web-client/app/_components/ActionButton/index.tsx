import classNames from "classnames";
import Image from "next/image";

type Props = {
  title: string;
  icon: string;
  isLoading?: boolean;
  onClick: () => void;
};

const ActionButton: React.FC<Props> = (props) => {
  return (
    <>
      {!props.isLoading && (
        <button
          type="button"
          className={classNames(
            "rounded-xl flex items-center h-[40px] gap-1 bg-[#F3F4F6] px-2 text-xs font-normal text-gray-900 shadow-sm",
            !props.isLoading && "hover:bg-indigo-100"
          )}
          onClick={props.onClick}
        >
          <Image src={props.icon} width={16} height={16} alt="" />
          <span>{props.title}</span>
        </button>
      )}
      {props.isLoading && (
        <div className="w-[80px] flex flex-row justify-center items-center">
          <Image
            src="icons/loading.svg"
            width={32}
            height={32}
            alt="loading"
          />
        </div>
      )}
    </>
  );
};

export default ActionButton;
