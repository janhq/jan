import Image from "next/image";
type Props = {
  onTabClick: (clickedTab: "description" | "api") => void;
  tab: string;
};

export const TabModelDetail: React.FC<Props> = ({ onTabClick, tab }) => {
  const btns = [
    {
      name: "api",
      icon: "/icons/unicorn_arrow.svg",
    },
    {
      name: "description",
      icon: "/icons/unicorn_exclamation-circle.svg",
    },
  ];

  return (
    <div className="flex gap-[2px] rounded p-1 w-full bg-gray-200">
      {btns.map((item, index) => (
        <button
          key={index}
          onClick={() => onTabClick(item.name as "description" | "api")}
          className={`w-1/2 capitalize flex items-center justify-center py-[6px] px-3 gap-2 relative text-sm leading-5 ${
            tab !== item.name ? "" : "bg-white rounded shadow-sm"
          }`}
        >
          <Image src={item.icon} width={20} height={20} alt="" />
          {item.name}
        </button>
      ))}
    </div>
  );
};
