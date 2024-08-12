import { AnimatePresence } from 'framer-motion'

import { useAtomValue } from 'jotai'

import { twMerge } from 'tailwind-merge'

import LeftPanelContainer from '@/containers/LeftPanelContainer'

import ThreadItem from './ThreadItem'

import { threadsAtom } from '@/helpers/atoms/Thread.atom'

const ThreadLeftPanel: React.FC = () => {
  const threads = useAtomValue(threadsAtom)

  return (
    <LeftPanelContainer>
      <div className={twMerge('pl-1.5 pt-3')}>
        <AnimatePresence>
          {threads.map((thread) => (
            <ThreadItem key={thread.id} thread={thread} />
          ))}
        </AnimatePresence>
      </div>
    </LeftPanelContainer>
  )
}

export default ThreadLeftPanel
