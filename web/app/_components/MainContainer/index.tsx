'use client'

import React from 'react'
import LeftContainer from '../LeftContainer'
import RightContainer from '../RightContainer'
import { Variants, motion } from 'framer-motion'
import { useAtomValue } from 'jotai'
import { leftSideBarExpandStateAtom } from '@/_helpers/atoms/LeftSideBarExpand.atom'

const leftSideBarVariants: Variants = {
  show: {
    x: 0,
    width: 320,
    opacity: 1,
    transition: { duration: 0.1 },
  },
  hide: {
    x: '-100%',
    width: 0,
    opacity: 0,
    transition: { duration: 0.1 },
  },
}

const MainContainer: React.FC = () => {
  const leftSideBarExpand = useAtomValue(leftSideBarExpandStateAtom)

  return (
    <div className="flex">
      <motion.div
        initial={false}
        animate={leftSideBarExpand ? 'show' : 'hide'}
        variants={leftSideBarVariants}
        className="flex h-screen w-80 flex-shrink-0 flex-col border-r border-gray-200 py-3"
      >
        <LeftContainer />
      </motion.div>
      <div className="flex h-screen flex-1 flex-col">
        <RightContainer />
      </div>
    </div>
  )
}

export default MainContainer
