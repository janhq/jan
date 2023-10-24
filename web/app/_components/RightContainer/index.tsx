import { rightSideBarExpandStateAtom } from '@helpers/atoms/SideBarExpand.atom'
import { Variants, motion } from 'framer-motion'
import { useAtomValue } from 'jotai'
import { Fragment } from 'react'
import BotSetting from '../BotSetting'
import BotInfo from '../BotInfo'

const variants: Variants = {
  show: {
    x: 0,
    width: 320,
    opacity: 1,
    transition: { duration: 0.3 },
  },
  hide: {
    x: '100%',
    width: 0,
    opacity: 0,
    transition: { duration: 0.3 },
  },
}

const RightContainer = () => {
  const isVisible = useAtomValue(rightSideBarExpandStateAtom)

  return (
    <motion.div
      initial={false}
      animate={isVisible ? 'show' : 'hide'}
      variants={variants}
      className="scroll flex w-80 flex-shrink-0 flex-col overflow-y-auto border-l border-gray-200 py-3"
    >
      {isVisible && (
        <Fragment>
          <BotInfo />

          {/* Divider */}
          <div className="relative">
            <div
              className="absolute inset-0 flex items-center"
              aria-hidden="true"
            >
              <div className="w-full border-t border-gray-300" />
            </div>
          </div>

          <BotSetting />
        </Fragment>
      )}
    </motion.div>
  )
}

export default RightContainer
