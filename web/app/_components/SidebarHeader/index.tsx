import Image from "next/image";

const SidebarHeader: React.FC = () => {
  return (
    <div className="flex flex-col gap-[10px]">
      <Image src={"icons/Jan_AppIcon.svg"} width={68} height={28} alt="" />
    </div>
  );
};

export default SidebarHeader;
