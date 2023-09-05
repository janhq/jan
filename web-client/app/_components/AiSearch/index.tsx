import Image from "next/image";

const Search: React.FC = () => {
  return (
    <div className="flex bg-gray-200 w-[343px] h-[36px] items-center px-2 gap-[6px] rounded-md">
      <Image
        src={"/icons/magnifyingglass.svg"}
        width={15.63}
        height={15.78}
        alt=""
      />
      <input
        className="bg-inherit outline-0 w-full border-0 p-0 focus:ring-0"
        placeholder="Search"
      />
    </div>
  );
};

export default Search;
