import Image from "next/image";
import Link from "next/link";

const SidebarMenu: React.FC = () => {
  const menu = [
    {
      name: "Chat History",
      icon: "ClipboardList",
      url: "#",
    },
    {
      name: "Explore Models",
      icon: "Search_gray",
      url: "#",
    },
    {
      name: "My Models",
      icon: "ViewGrid",
      url: "#",
    },
    {
      name: "Settings",
      icon: "Cog",
      url: "/settings",
    },
  ];

  return (
    <div className="flex-1 flex flex-col justify-end">
      <div className="text-gray-500 text-xs font-semibold py-2 pl-2 pr-3">
        Your Configurations
      </div>
      {menu.map((item, index) => (
        <div key={index} className="py-2 pl-2 pr-3">
          <Link
            href={item.url}
            className="flex items-center gap-3 text-base text-gray-600"
          >
            <Image
              src={`icons/${item.icon}.svg`}
              width={24}
              height={24}
              alt=""
            />
            {item.name}
          </Link>
        </div>
      ))}
    </div>
  );
};

export default SidebarMenu;
