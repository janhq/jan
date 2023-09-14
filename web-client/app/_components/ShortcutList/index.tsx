"use client";

import React, { useEffect, useState } from "react";
import ShortcutItem from "../ShortcutItem";
import { GetProductsDocument, GetProductsQuery } from "@/graphql";
import ExpandableHeader from "../ExpandableHeader";
import { useQuery } from "@apollo/client";
import { useAtomValue } from "jotai";
import { Product, toProduct } from "@/_models/Product";
import { searchAtom } from "@/_atoms/SearchAtoms";

const ShortcutList: React.FC = () => {
  const searchText = useAtomValue(searchAtom);
  const { data } = useQuery<GetProductsQuery>(GetProductsDocument);
  const [expand, setExpand] = useState<boolean>(true);
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);

  useEffect(() => {
    if (data?.products) {
      const products: Product[] = data.products.map((p) => toProduct(p));
      setFeaturedProducts(
        [...(products || [])]
          .sort(() => 0.5 - Math.random())
          .slice(0, 3)
          .filter(
            (e) =>
              searchText === "" ||
              e.name.toLowerCase().includes(searchText.toLowerCase())
          ) || []
      );
    }
  }, [data?.products, searchText]);

  return (
    <div className="flex flex-col mt-6 gap-2">
      <ExpandableHeader
        title="START A NEW CHAT"
        expanded={expand}
        onClick={() => setExpand(!expand)}
      />
      {expand ? (
        <div className="flex flex-row mx-1 items-center rounded-lg hover:bg-hover-light">
          {featuredProducts.map((product) => (
            <ShortcutItem key={product.slug} product={product} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default ShortcutList;
