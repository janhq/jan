"use client";
import React, { useEffect, useState } from "react";
import SearchBar from "../SearchBar";
import ShortcutList from "../ShortcutList";
import HistoryList from "../HistoryList";
import { observer } from "mobx-react-lite";
import { useStore } from "@/_models/RootStore";
import Image from "next/image";
import { usePathname } from "next/navigation";
import useGetUserConversations from "@/_hooks/useGetUserConversations";
import DiscordContainer from "../DiscordContainer";
import { useQuery } from "@apollo/client";
import {
  GetProductsQuery,
  GetProductsDocument,
  ProductDetailFragment,
} from "@/graphql";
import useGetCurrentUser from "@/_hooks/useGetCurrentUser";

export const SidebarLeft: React.FC = observer(() => {
  const router = usePathname();
  const [searchText, setSearchText] = useState("");
  const { user } = useGetCurrentUser();
  const { getUserConversations } = useGetUserConversations();
  const [featuredProducts, setFeaturedProducts] = useState<
    ProductDetailFragment[]
  >([]);

  const { historyStore } = useStore();
  const navigation = ["pricing", "docs", "about"];

  const { loading, error, data } =
    useQuery<GetProductsQuery>(GetProductsDocument);

  const checkRouter = () =>
    navigation.map((item) => router?.includes(item)).includes(true);

  useEffect(() => {
    if (user) {
      const createConversationAndActive = async () => {
        await getUserConversations(user);
      };
      createConversationAndActive();
    }
  }, [user]);

  useEffect(() => {
    if (data?.products) {
      setFeaturedProducts(
        [...(data.products || [])]
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

  const onLogoClick = () => {
    historyStore.clearActiveConversationId();
  };
  const onSearching = (text: string) => {
    setSearchText(text);
  };

  return (
    <div
      className={`${
        historyStore.showAdvancedPrompt ? "lg:hidden" : "lg:flex"
      } ${
        checkRouter() ? "lg:hidden" : "lg:block"
      } hidden lg:inset-y-0 lg:w-72 lg:flex-col flex-shrink-0 overflow-hidden border-r border-gray-200 dark:bg-gray-800`}
    >
      <div className="h-full flex grow flex-col overflow-hidden">
        <button className="p-3 flex gap-3" onClick={onLogoClick}>
          <div className="flex gap-[2px] items-center">
            <Image src={"/icons/app_icon.svg"} width={28} height={28} alt="" />
            <Image src={"/icons/Jan.svg"} width={27} height={12} alt="" />
          </div>
        </button>
        <div className="flex flex-col gap-3 overflow-x-hidden h-full">
          <div className="flex items-center px-3">
            <SearchBar onTextChanged={onSearching} />
          </div>
          <div className="flex flex-col h-full overflow-x-hidden scroll gap-3">
            {data && <ShortcutList products={featuredProducts} />}
            {loading && (
              <div className="w-full flex flex-row justify-center items-center">
                <Image
                  src="/icons/loading.svg"
                  width={32}
                  height={32}
                  alt="loading"
                />
              </div>
            )}
            <HistoryList searchText={searchText} />
          </div>
        </div>
      </div>
      <div className="flex-grow">
        <DiscordContainer />
      </div>
    </div>
  );
});
