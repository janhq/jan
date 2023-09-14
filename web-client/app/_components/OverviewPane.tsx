"use client";

import { useAtomValue } from "jotai";
import TryItYourself from "./TryItYourself";
import React from "react";
import { activeConversationAtom } from "@/_atoms/ConversationAtoms";

const OverviewPane: React.FC = () => {
  const activeConvo = useAtomValue(activeConversationAtom);

  return (
    <div className="scroll overflow-y-auto">
      <div className="flex flex-col flex-grow gap-6 m-3">
        <AboutProductItem
          title={"About this AI"}
          value={activeConvo?.product?.description ?? ""}
        />
        <SmallItem
          title={"Model Version"}
          value={activeConvo?.product?.version ?? ""}
        />
        <div className="flex flex-col">
          <span className="text-[#6B7280]">Model URL</span>
          <a
            className="text-[#1C64F2]"
            href={activeConvo?.product?.modelUrl ?? "#"}
            target="_blank_"
          >
            {activeConvo?.product?.modelUrl}
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
