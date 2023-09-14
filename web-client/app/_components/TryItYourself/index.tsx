import { currentProductAtom, currentPromptAtom } from "@/_helpers/JotaiWrapper";
import { GetProductPromptsQuery, GetProductPromptsDocument } from "@/graphql";
import { useQuery } from "@apollo/client";
import { useAtomValue, useSetAtom } from "jotai";

const TryItYourself = () => {
  const setCurrentPrompt = useSetAtom(currentPromptAtom);
  const product = useAtomValue(currentProductAtom);
  const { data } = useQuery<GetProductPromptsQuery>(GetProductPromptsDocument, {
    variables: { productSlug: product?.slug ?? "" },
  });

  if (!data || data.prompts.length === 0) {
    return <div />;
  }

  const promps = data.prompts;

  return (
    <div className="flex flex-col gap-4 tracking-[-0.4px] leading-[22px] text-base">
      <h2 className="font-bold">Try it yourself</h2>
      <ul className="border-[1px] border-[#D1D5DB] rounded-[12px]">
        {promps.map((prompt, index) => (
          <button
            onClick={() => setCurrentPrompt(prompt.content ?? "")}
            key={prompt.slug}
            className={`text-sm text-gray-500 leading-[20px] flex gap-[10px] border-b-[${
              index !== promps.length - 1 ? "1" : "0"
            }px] border-[#E5E7EB] hover:text-blue-400 text-left p-3 w-full`}
          >
            {prompt.content}
          </button>
        ))}
      </ul>
    </div>
  );
};

export default TryItYourself;
