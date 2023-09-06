import React from "react";
import Slider from "../Slider";
import ConversationalList from "../ConversationalList";
import GenerateImageList from "../GenerateImageList";
import { GetProductsQuery, GetProductsDocument } from "@/graphql";
import { useQuery } from "@apollo/client";
import Image from "next/image";

const NewChatBlankState: React.FC = () => {
  // This can be achieved by separating queries using GetProductsByCollectionSlugQuery
  const { loading, data } = useQuery<GetProductsQuery>(GetProductsDocument, {
    variables: { slug: "conversational" },
  });

  const featured = [...(data?.products ?? [])]
    .sort(() => 0.5 - Math.random())
    .slice(0, 3);

  const conversational =
    data?.products.filter((e) =>
      e.product_collections.some((c) =>
        c.collections.some((s) => s.slug == "conversational")
      )
    ) ?? [];

  const generativeArts =
    data?.products.filter((e) =>
      e.product_collections.some((c) =>
        c.collections.some((s) => s.slug == "text-to-image")
      )
    ) ?? [];

  if (loading) {
    return (
      <div className="w-full flex flex-row justify-center items-center">
        <Image src="/icons/loading.svg" width={32} height={32} alt="loading" />
      </div>
    );
  }

  if (!data || data.products.length === 0) {
    return <div></div>;
  }

  return (
    <div className="bg-gray-100 px-6 pt-8 w-full h-full overflow-y-scroll scroll">
      <Slider products={featured} />
      <ConversationalList products={conversational} />
      <GenerateImageList products={generativeArts} />
    </div>
  );
};

export default NewChatBlankState;
