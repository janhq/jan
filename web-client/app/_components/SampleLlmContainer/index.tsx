import JanWelcomeTitle from "../JanWelcomeTitle";
import { useQuery } from "@apollo/client";
import { GetProductPromptsDocument, GetProductPromptsQuery } from "@/graphql";
import { Product } from "@/_models/Product";
import { useSetAtom } from "jotai";
import { currentPromptAtom } from "@/_helpers/JotaiWrapper";

type Props = {
  product: Product;
};

const SampleLlmContainer: React.FC<Props> = ({ product }) => {
  const setCurrentPrompt = useSetAtom(currentPromptAtom);
  const { data } = useQuery<GetProductPromptsQuery>(GetProductPromptsDocument, {
    variables: { productSlug: product.slug },
  });

  return (
    <div className="flex flex-col max-w-sm flex-shrink-0 gap-9 items-center pt-6 mx-auto">
      <JanWelcomeTitle
        title={product.name}
        description={product.description ?? ""}
      />
      <div className="flex flex-col">
        <h2 className="font-semibold text-xl leading-6 tracking-[-0.4px] mb-5">
          Try now
        </h2>
        <div className="flex flex-col">
          {data?.prompts.map((item) => (
            <button
              onClick={() => setCurrentPrompt(item.content ?? "")}
              key={item.slug}
              className="rounded p-2 hover:bg-[#0000000F] text-xs leading-[18px] text-gray-500 text-left"
            >
              <span className="line-clamp-3">{item.content}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SampleLlmContainer;
