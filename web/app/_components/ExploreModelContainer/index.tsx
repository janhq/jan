import ExploreModelItem from "../ExploreModelItem";
import HeaderTitle from "../HeaderTitle";
import SearchBar, { SearchType } from "../SearchBar";
import SimpleCheckbox from "../SimpleCheckbox";
import SimpleTag, { TagType } from "../SimpleTag";
import useGetHuggingFaceModel from "@/_hooks/useGetHuggingFaceModel";
import { useAtomValue } from "jotai";
import { modelSearchAtom } from "@/_helpers/JotaiWrapper";
import { useEffect } from "react";

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

const ExploreModelContainer: React.FC = () => {
  const modelSearch = useAtomValue(modelSearchAtom);
  const { modelList, getHuggingFaceModel } = useGetHuggingFaceModel();

  useEffect(() => {
    getHuggingFaceModel(modelSearch);
  }, [modelSearch]);

  return (
    <div className="flex flex-col flex-1 px-16 pt-14 overflow-hidden">
      <HeaderTitle title="Explore Models" />
      <SearchBar
        type={SearchType.Model}
        placeholder="Owner name like TheBloke, etc.."
      />
      <div className="flex flex-1 gap-x-10 mt-9 overflow-hidden">
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
        <div className="flex-1 pb-4 gap-y-4 overflow-y-auto scroll">
          {modelList.map((item) => (
            <ExploreModelItem key={item.id} model={item} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default ExploreModelContainer;
