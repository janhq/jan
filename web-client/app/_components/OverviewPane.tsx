"use client";

import { useAtomValue } from "jotai";
import TryItYourself from "./TryItYourself";
import React from "react";
import { currentProductAtom } from "@/_helpers/JotaiWrapper";

const OverviewPane: React.FC = () => {
  const product = useAtomValue(currentProductAtom);

  return (
    <div className="scroll overflow-y-auto">
      <div className="flex flex-col flex-grow gap-6 m-3">
        <AboutProductItem
          title={"About this AI"}
          value={product?.description ?? ""}
        />
        <SmallItem title={"Model Version"} value={product?.version ?? ""} />
        <div className="flex flex-col">
          <span className="text-[#6B7280]">Model URL</span>
          <a
            className="text-[#1C64F2]"
            href={product?.modelUrl ?? "#"}
            target="_blank_"
          >
            {product?.modelUrl}
          </a>
        </div>
        <TryItYourself />
      </div>
    </div>
  );
};

export default OverviewPane;

type Props = {
  title: string;
  value: string;
};

const AboutProductItem: React.FC<Props> = ({ title, value }) => {
  return (
    <div className="flex flex-col items-start">
      <h2 className="text-black font-bold">{title}</h2>
      <p className="text-[#6B7280]">{value}</p>
    </div>
  );
};

const SmallItem: React.FC<Props> = ({ title, value }) => {
  return (
    <div className="flex flex-col">
      <span className="text-[#6B7280] ">{title}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
};
