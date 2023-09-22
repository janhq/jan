import Image from "next/image";

const SidebarHeader: React.FC = () => {
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex items-center justify-between">
        <Image src={"icons/Jan_AppIcon.svg"} width={68} height={28} alt="" />
      </div>
    </div>
  );
};

export default SidebarHeader;
