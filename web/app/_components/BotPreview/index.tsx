import Image from "next/image";

const BotPreview: React.FC = () => {
  return (
    <div className="flex pb-2 flex-col border border-gray-400 min-h-[235px] gap-2 overflow-hidden rounded-lg">
      <div className="flex items-center justify-center p-2 bg-gray-400">
        <Image
          className="rounded-md"
          src={
            "https://i.pinimg.com/564x/52/b1/6f/52b16f96f52221d48bea716795ccc89a.jpg"
          }
          width={32}
          height={32}
          alt=""
        />
      </div>
      <div className="flex items-center text-xs text-gray-400 gap-1 px-1">
        <div className="flex-grow mx-1 border-b border-gray-400"></div>
        Context cleared
        <div className="flex-grow mx-1 border-b border-gray-400"></div>
      </div>
    </div>
  );
};

export default BotPreview;
