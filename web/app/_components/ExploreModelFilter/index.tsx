import React from "react";
import SearchBar from "../SearchBar";
import SimpleCheckbox from "../SimpleCheckbox";
import SimpleTag, { TagType } from "../SimpleTag";

const tags = [
  "Roleplay",
  "Llama",
  "Story",
  "Casual",
  "Professional",
  "CodeLlama",
  "Coding",
];
const checkboxs = ["GGUF", "TensorRT", "Meow", "JigglyPuff"];

const ExploreModelFilter: React.FC = () => {
  const enabled = false;
  if (!enabled) return null;

  return (
    <div className="w-64">
      <h2 className="font-semibold text-xs mb-[15px]">Tags</h2>
      <SearchBar placeholder="Filter by tags" />
      <div className="flex flex-wrap gap-[9px] mt-[14px]">
        {tags.map((item) => (
          <SimpleTag key={item} title={item} type={item as TagType} />
        ))}
      </div>
      <hr className="my-10" />
      <fieldset>
        {checkboxs.map((item) => (
          <SimpleCheckbox key={item} name={item} />
        ))}
      </fieldset>
    </div>
  );
};

export default ExploreModelFilter;
