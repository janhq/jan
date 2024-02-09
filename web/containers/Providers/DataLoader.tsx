'use client'

import { Fragment, ReactNode } from 'react'

import useAssistants from '@/hooks/useAssistants'
import useModels from '@/hooks/useModels'
import useThreads from '@/hooks/useThreads'

type Props = {
  children: ReactNode
}

const DataLoader: React.FC<Props> = ({ children }) => {
  useModels()
  useThreads()
  useAssistants()

  return <Fragment>{children}</Fragment>
}

export default DataLoader
