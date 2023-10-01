"use client";

import { searchingModelText } from "@/_helpers/JotaiWrapper";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { useSetAtom } from "jotai";
import { useEffect, useState } from "react";

const ModelSearchBar: React.FC = () => {
  const setSearchtext = useSetAtom(searchingModelText);
  const [text, setText] = useState("");
  useEffect(() => {
    setSearchtext(text);
  }, [text, setSearchtext]);
  return (
    <div className="py-[27px] flex items-center justify-center">
      <div className="w-[520px] h-[42px] flex items-center">
        <input
          className="outline-none bg-gray-300 text-sm h-full rounded-tl-lg rounded-bl-lg leading-[17.5px] border border-gray-300 py-3 px-4 flex-1"
          placeholder="Search model"
          value={text}
          onChange={(text) => setText(text.currentTarget.value)}
        />
        <button className="flex items-center justify-center bg-gray-800 border border-gray-800 p-2 w-[42px] rounded-tr-lg rounded-br-lg h-[42px]">
          <MagnifyingGlassIcon width={20} height={20} color="#FFFFFF" />
        </button>
      </div>
    </div>
  );
};

export default ModelSearchBar;
