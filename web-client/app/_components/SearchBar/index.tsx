import Image from "next/image";

interface ISearchBarProps {
  onTextChanged: (text: string) => void;
}
const SearchBar: React.FC<ISearchBarProps> = (props) => {
  return (
    <div className="relative mt-3 flex items-center w-full">
      <div className="absolute top-0 left-2 h-full flex items-center">
        <Image src={"/icons/search.svg"} width={16} height={16} alt="" />
      </div>
      <input
        type="text"
        name="search"
        id="search"
        placeholder="Search (⌘K)"
        onChange={(e) => props.onTextChanged(e.target.value)}
        className="block w-full rounded-md border-0 py-1.5 pl-8 pr-14 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
      />
    </div>
  );
};

export default SearchBar;
