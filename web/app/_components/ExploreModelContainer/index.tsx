import ExploreModelItem from "../ExploreModelItem";
import HeaderTitle from "../HeaderTitle";
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
const data = [
  {
    name: "Llama-7B-Chat-GGUF",
    total: 107000,
    status: "Recommended",
    modelFormat: "GGUF",
    releaseDate: "20 Sep 2023",
    hardwareCompatibility: ["Insufficient RAM", "Compatible"],
    expectedPerformance: "medium, balanced quality",
    description:
      "This model is made for chatting. Primary intended uses The primary use of LLaMA is for research on large language LLaMA is research.",
    tags: ["Roleplay", "Professional"],
  },
  {
    name: "Llama-7B-Chat-GGUF",
    total: 107000,
    status: "Recommended",
    modelFormat: "GGUF",
    releaseDate: "20 Sep 2023",
    hardwareCompatibility: ["Insufficient RAM", "Compatible"],
    expectedPerformance: "medium, balanced quality",
    description:
      "This model is made for chatting. Primary intended uses The primary use of LLaMA is for research on large language LLaMA is research.",
    tags: ["Roleplay", "Professional"],
  },
  {
    name: "Llama-7B-Chat-GGUF",
    total: 107000,
    status: "Recommended",
    modelFormat: "GGUF",
    releaseDate: "20 Sep 2023",
    hardwareCompatibility: ["Insufficient RAM", "Compatible"],
    expectedPerformance: "medium, balanced quality",
    description:
      "This model is made for chatting. Primary intended uses The primary use of LLaMA is for research on large language LLaMA is research.",
    tags: ["Roleplay", "Professional"],
  },
];

const ExploreModelContainer: React.FC = () => {
  return (
    <div className="flex flex-col w-full h-full pl-[63px] pr-[89px] pt-[60px] overflow-y-auto">
      <HeaderTitle title="Explore Models" />
      <SearchBar placeholder="Search or HuggingFace URL" />
      <div className="flex gap-x-14 mt-[38px]">
        <div className="flex-1 flex-shrink-0">
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
        <div className="flex-[3_3_0%]">
          <h2 className="font-semibold text-xs mb-[18px]">Results</h2>
          <div className="flex flex-col gap-[31px]">
            {data.map((item, index) => (
              <ExploreModelItem key={index} {...item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExploreModelContainer;
