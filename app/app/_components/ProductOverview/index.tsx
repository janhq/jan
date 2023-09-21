import React from "react";
import useGetModels from "@/_hooks/useGetModels";

const ProductOverview: React.FC = () => {
  const { models } = useGetModels();

  return <div className="bg-gray-100 overflow-y-auto flex-grow scroll"></div>;
};

export default ProductOverview;
