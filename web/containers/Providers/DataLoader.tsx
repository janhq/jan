'use client'

import { Fragment, ReactNode } from 'react'

import useAppConfig from '@/hooks/useAppConfig'
import useAssistants from '@/hooks/useAssistants'
import useGetSystemResources from '@/hooks/useGetSystemResources'
import useModels from '@/hooks/useModels'
import useThreads from '@/hooks/useThreads'

type Props = {
  children: ReactNode
}

const DataLoader: React.FC<Props> = ({ children }) => {
  useModels()
  useThreads()
  useAssistants()
  useGetSystemResources()
  useAppConfig()

  console.debug('Load Data...')

  return <Fragment>{children}</Fragment>
}

export default DataLoader
