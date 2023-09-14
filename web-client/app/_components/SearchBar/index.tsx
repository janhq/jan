import { searchAtom } from "@/_helpers/JotaiWrapper";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { useSetAtom } from "jotai";

const SearchBar: React.FC = () => {
  const setText = useSetAtom(searchAtom);

  return (
    <div className="relative mx-3 mt-3 flex items-center">
      <div className="absolute top-0 left-2 h-full flex items-center">
        <MagnifyingGlassIcon
          width={16}
          height={16}
          color="#3C3C43"
          opacity={0.6}
        />
      </div>
      <input
        type="text"
        name="search"
        id="search"
        placeholder="Search (⌘K)"
        onChange={(e) => setText(e.target.value)}
        className="block w-full rounded-md border-0 py-1.5 pl-8 pr-14 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
      />
    </div>
  );
};

export default SearchBar;
