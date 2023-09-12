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
import {  PlusSmallIcon,
          Cog6ToothIcon,
          UserIcon 
        } from '@heroicons/react/20/solid'
import useCreateConversation from "@/_hooks/useCreateConversation";

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
    <div className="flex grow flex-col overflow-y-auto border-r border-gray-200 bg-white">
  
      <div className="flex grow flex-col overflow-y-auto">

          {/* New Chat Button */}
          <div className="flex w-full items-center px-3 pt-2">
            <button
              type="button"
              className="inline-flex w-full items-center gap-x-1.5 rounded-md bg-white ring-1 px-3 py-2 text-sm ring-gray-300 hover:bg-gray-50">
                
              <PlusSmallIcon className="-ml-0.5 h-5 w-5" aria-hidden="true" />
              New Chat
            </button>
          </div>
          
          
           {/* Search bar */}
          <div className="flex items-center px-3">
            <SearchBar onTextChanged={onSearching} />
          </div>
      
        

          {/* Chat list */}
          <div className="flex flex-col h-full overflow-x-hidden scroll gap-3">
            <HistoryList searchText={searchText} />
          </div>
      </div>

      {/* Logo & Settings */}
      <div className="flex-col overflow-hidden pt-2 pb-4 px-3">
            
            {/* Logo */}
            <button onClick={onLogoClick}>
              <img
              className="h-10 w-auto"
              src={"/icons/app_icon.svg"} width={100} height={28} alt="" />
            </button>
            
            {/* Settings */}
            <button
              type="button"
              className="text-gray-600 inline-flex w-full items-center gap-x-1.5 rounded-md bg-white px-3.5 py-2.5 text-sm hover:bg-gray-100">
                
              <Cog6ToothIcon className="-ml-0.5 h-5 w-5" aria-hidden="true" />
              Settings
            </button>

            {/* User Profile */}
            <button
              type="button"
              className="text-gray-600 inline-flex w-full items-center gap-x-1.5 rounded-md bg-white px-3.5 py-2.5 text-sm hover:bg-gray-100">
                
              <UserIcon className="-ml-0.5 h-5 w-5" aria-hidden="true" />
              My Profile
            </button>

      </div>

    </div>

  );
});
