import Image from "next/image";
import React from "react";
import ShortcutItem from "../ShortcutItem";
import { observer } from "mobx-react-lite";
import { ProductDetailFragment } from "@/graphql";

type Props = {
  products: ProductDetailFragment[];
};

const ShortcutList: React.FC<Props> = observer(({ products }) => {
  const [expand, setExpand] = React.useState<boolean>(true);

  return (
    <div className="flex flex-col w-full px-3 pt-3">
      <button
        onClick={() => setExpand(!expand)}
        className="flex justify-between items-center"
      >
        <h2 className="text-[#9CA3AF] font-bold text-xs leading-[12px]">
          SHORTCUTS
        </h2>
        <Image
          className={`${expand ? "" : "rotate-180"}`}
          src={"/icons/unicorn_angle-up.svg"}
          width={24}
          height={24}
          alt=""
        />
      </button>
      <div
        className={`flex flex-col gap-3 py-2 ${!expand ? "hidden " : "block"}`}
      >
        {products.map((product) => (
          <ShortcutItem key={product.slug} product={product} />
        ))}
      </div>
    </div>
  );
});

export default ShortcutList;
