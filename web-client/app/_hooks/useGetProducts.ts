import { ProductType, toProduct } from "@/_models/Product";
import { GetProductsDocument, GetProductsQuery } from "@/graphql";
import { useQuery } from "@apollo/client";

export default function useGetProducts() {
  const { loading, data } = useQuery<GetProductsQuery>(GetProductsDocument, {
    variables: { slug: "conversational" },
  });

  const allProducts = (data?.products ?? []).map((e) => toProduct(e));

  const featured = allProducts.sort(() => 0.5 - Math.random()).slice(0, 3);
  const conversational = allProducts.filter((e) => e.type === ProductType.LLM);
  const generativeArts = allProducts.filter(
    (e) => e.type === ProductType.GenerativeArt
  );

  return {
    loading,
    featured,
    conversational,
    generativeArts,
  };
}
