import Image from "next/image";
import Link from "next/link";

const SidebarHeader: React.FC = () => {
  return (
    <div className="flex flex-col gap-[10px]">
      <Link href="/" className="flex items-center justify-between">
        <Image src={"icons/Jan_AppIcon.svg"} width={68} height={28} alt="" />
      </Link>
    </div>
  );
};

export default SidebarHeader;
