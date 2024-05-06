'use client'
import React, { useEffect } from 'react'

import { useTheme } from 'next-themes'

import { motion as m } from 'framer-motion'

import { useAtom, useAtomValue } from 'jotai'

import BottomBar from '@/containers/Layout/BottomBar'
import Ribbon from '@/containers/Layout/Ribbon'

import TopBar from '@/containers/Layout/TopBar'

import { MainViewState } from '@/constants/screens'

import { getImportModelStageAtom } from '@/hooks/useImportModel'

import { SUCCESS_SET_NEW_DESTINATION } from '@/screens/Settings/Advanced/DataFolder'
import CancelModelImportModal from '@/screens/Settings/CancelModelImportModal'
import ChooseWhatToImportModal from '@/screens/Settings/ChooseWhatToImportModal'
import EditModelInfoModal from '@/screens/Settings/EditModelInfoModal'
import HuggingFaceRepoDetailModal from '@/screens/Settings/HuggingFaceRepoDetailModal'
import ImportModelOptionModal from '@/screens/Settings/ImportModelOptionModal'
import ImportingModelModal from '@/screens/Settings/ImportingModelModal'
import SelectingModelModal from '@/screens/Settings/SelectingModelModal'

import LoadingModal from '../LoadingModal'

import MainViewContainer from '../MainViewContainer'

import InstallingExtensionModal from './BottomBar/InstallingExtension/InstallingExtensionModal'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'

const BaseLayout = () => {
  const [mainViewState, setMainViewState] = useAtom(mainViewStateAtom)
  const importModelStage = useAtomValue(getImportModelStageAtom)
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    setTheme(theme as string)
  }, [setTheme, theme])

  useEffect(() => {
    if (localStorage.getItem(SUCCESS_SET_NEW_DESTINATION) === 'true') {
      setMainViewState(MainViewState.Settings)
    }
  }, [setMainViewState])

  return (
    <>
      <TopBar />
      <div className="relative top-9 flex h-[calc(100vh-(36px+28px))] w-screen flex-1 overflow-hidden">
        <Ribbon />
        <div className="relative flex w-full overflow-hidden bg-[hsla(var(--app-bg))]">
          <div className="w-full">
            <m.div
              key={mainViewState}
              initial={{ opacity: 0, y: -8 }}
              className="h-full"
              animate={{
                opacity: 1,
                y: 0,
                transition: {
                  duration: 0.5,
                },
              }}
            >
              <MainViewContainer />
            </m.div>
          </div>
        </div>
        <LoadingModal />
        {importModelStage === 'SELECTING_MODEL' && <SelectingModelModal />}
        {importModelStage === 'MODEL_SELECTED' && <ImportModelOptionModal />}
        {importModelStage === 'IMPORTING_MODEL' && <ImportingModelModal />}
        {importModelStage === 'EDIT_MODEL_INFO' && <EditModelInfoModal />}
        {importModelStage === 'CONFIRM_CANCEL' && <CancelModelImportModal />}
        <ChooseWhatToImportModal />
        <InstallingExtensionModal />
        <HuggingFaceRepoDetailModal />
      </div>
      <BottomBar />
    </>
  )
}

export default BaseLayout
