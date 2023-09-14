import React from "react";
import Slider from "../Slider";
import ConversationalList from "../ConversationalList";
import GenerateImageList from "../GenerateImageList";
import Image from "next/image";
import useGetProducts from "@/_hooks/useGetProducts";

const ProductOverview: React.FC = () => {
  const { loading, featured, conversational, generativeArts } =
    useGetProducts();

  if (loading) {
    return (
      <div className="w-full flex flex-grow flex-row justify-center items-center">
        <Image src="icons/loading.svg" width={32} height={32} alt="loading" />
      </div>
    );
  }

  return (
    <div className="bg-gray-100 overflow-y-auto flex-grow scroll">
      <Slider products={featured} />
      <ConversationalList products={conversational} />
      <GenerateImageList products={generativeArts} />
    </div>
  );
};

export default ProductOverview;
