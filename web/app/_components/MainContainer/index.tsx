"use client";

import React from "react";
import LeftContainer from "../LeftContainer";
import RightContainer from "../RightContainer";
import { Variants, motion } from "framer-motion";
import { useAtomValue } from "jotai";
import { leftSideBarExpandStateAtom } from "@/_helpers/atoms/LeftSideBarExpand.atom";

const leftSideBarVariants: Variants = {
  show: {
    x: 0,
    width: 320,
    opacity: 1,
    transition: { duration: 0.1 },
  },
  hide: {
    x: "-100%",
    width: 0,
    opacity: 0,
    transition: { duration: 0.1 },
  },
};

const MainContainer: React.FC = () => {
  const leftSideBarExpand = useAtomValue(leftSideBarExpandStateAtom);

  return (
    <div className="flex">
      <motion.div
        initial={false}
        animate={leftSideBarExpand ? "show" : "hide"}
        variants={leftSideBarVariants}
        className="w-80 flex-shrink-0 py-3 h-screen border-r border-gray-200 flex flex-col"
      >
        <LeftContainer />
      </motion.div>
      <div className="flex flex-col flex-1 h-screen">
        <RightContainer />
      </div>
    </div>
  );
};

export default MainContainer;
