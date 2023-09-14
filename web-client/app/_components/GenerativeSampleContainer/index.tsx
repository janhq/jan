import JanWelcomeTitle from "../JanWelcomeTitle";
import { GetProductPromptsQuery, GetProductPromptsDocument } from "@/graphql";
import { useQuery } from "@apollo/client";
import { Product } from "@/_models/Product";
import { useSetAtom } from "jotai";
import { currentPromptAtom } from "@/_atoms/PromptAtoms";

type Props = {
  product: Product;
};

const GenerativeSampleContainer: React.FC<Props> = ({ product }) => {
  const setPrompt = useSetAtom(currentPromptAtom);
  const { data } = useQuery<GetProductPromptsQuery>(GetProductPromptsDocument, {
    variables: { productSlug: product.slug },
  });

  return (
    <div className="flex flex-col max-w-2xl flex-shrink-0 mx-auto mt-6">
      <JanWelcomeTitle
        title={product.name}
        description={product.longDescription}
      />
      <div className="flex flex-col">
        <h2 className="font-semibold text-xl leading-6 tracking-[-0.4px] mb-5">
          Create now
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
          {data?.prompts.map((item) => (
            <button
              key={item.slug}
              onClick={() => setPrompt(item.content ?? "")}
              className="w-full h-full"
            >
              <img
                style={{ objectFit: "cover" }}
                className="w-full h-full rounded col-span-1 flex flex-col"
                src={item.image_url ?? ""}
                alt=""
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default GenerativeSampleContainer;
