import { GetProductPromptsDocument, GetProductPromptsQuery } from "@/graphql";
import { useQuery } from "@apollo/client";
import { useLayoutEffect, useRef, useState } from "react";

type Props = {
  slug: string;
  description?: string | null;
  technicalVersion?: string | null;
  technicalURL?: string | null;
  onPromptClick?: (prompt: string) => void;
  inAIModel?: number;
};

const OverviewPane: React.FC<Props> = ({
  slug,
  description,
  technicalVersion,
  technicalURL,
  onPromptClick,
  inAIModel,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [read, setRead] = useState<boolean>(true);
  const [height, setHeight] = useState<number>(0);
  const { loading, error, data } = useQuery<GetProductPromptsQuery>(
    GetProductPromptsDocument,
    {
      variables: { productSlug: slug },
    }
  );

  useLayoutEffect(() => {
    if (!ref.current) return;
    setHeight(ref.current?.offsetHeight);
  }, [read]);

  return (
    <div
      className="w-full flex flex-auto flex-col gap-6 overflow-x-hidden scroll"
      ref={ref}
      style={!inAIModel ? { height: `${height}px` } : { height: "100%" }}
    >
      <div className="flex flex-col gap-2 items-start">
        <h2 className="text-black font-bold">About this AI</h2>
        <p className={`text-[#6B7280] ${read ? "hidden-text-model" : ""}`}>
          {description}
        </p>
        <button
          onClick={() => setRead(!read)}
          className="text-[#1F2A37] font-bold"
        >
          {read ? "read more" : "read less"}
        </button>
      </div>
      <div className="flex flex-col gap-4 tracking-[-0.4px] leading-[22px] text-base">
        <div className="flex flex-col gap-1">
          <span className="text-[#6B7280] ">Model Version</span>
          <span className="font-semibold">{technicalVersion}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[#6B7280]">Model URL</span>
          <a
            className="text-[#1C64F2] break-all pr-10"
            href={technicalURL || "#"}
            target="_blank_"
          >
            {technicalURL}
          </a>
        </div>
      </div>
      <div className="flex flex-col gap-4 tracking-[-0.4px] leading-[22px] text-base">
        <h2 className="font-bold">Try it yourself</h2>
        <ul className="border-[1px] border-[#D1D5DB] rounded-[12px]">
          {data?.prompts.map((prompt, index) => {
            const showBorder = index !== data?.prompts.length - 1;
            return (
              <button
                onClick={() => onPromptClick?.(prompt.content ?? "")}
                key={prompt.slug}
                className={`text-sm text-gray-500 leading-[20px] flex gap-[10px] border-b-[${
                  showBorder ? "1" : "0"
                }px] border-[#E5E7EB] hover:text-blue-400 text-left p-3 w-full`}
              >
                {prompt.content}
              </button>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default OverviewPane;
