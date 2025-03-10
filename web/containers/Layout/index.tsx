'use client'

import { useEffect, useState } from 'react'

import { Button } from '@janhq/joi'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import posthog from 'posthog-js'
import { twMerge } from 'tailwind-merge'

import BottomPanel from '@/containers/Layout/BottomPanel'
import RibbonPanel from '@/containers/Layout/RibbonPanel'

import TopPanel from '@/containers/Layout/TopPanel'

import { MainViewState } from '@/constants/screens'

import { getImportModelStageAtom } from '@/hooks/useImportModel'

import { SUCCESS_SET_NEW_DESTINATION } from '@/screens/Settings/Advanced/DataFolder'
import CancelModelImportModal from '@/screens/Settings/CancelModelImportModal'
import ChooseWhatToImportModal from '@/screens/Settings/ChooseWhatToImportModal'
import EditModelInfoModal from '@/screens/Settings/EditModelInfoModal'
import ImportModelOptionModal from '@/screens/Settings/ImportModelOptionModal'
import ImportingModelModal from '@/screens/Settings/ImportingModelModal'
import SelectingModelModal from '@/screens/Settings/SelectingModelModal'

import { getAppDistinctId, updateDistinctId } from '@/utils/settings'

import LoadingModal from '../LoadingModal'

import MainViewContainer from '../MainViewContainer'

import ModalAppUpdaterChangelog from '../ModalAppUpdaterChangelog'

import ModalAppUpdaterNotAvailable from '../ModalAppUpdaterNotAvailable'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import {
  productAnalyticAtom,
  productAnalyticPromptAtom,
  reduceTransparentAtom,
  showScrollBarAtom,
} from '@/helpers/atoms/Setting.atom'

const BaseLayout = () => {
  const setMainViewState = useSetAtom(mainViewStateAtom)
  const importModelStage = useAtomValue(getImportModelStageAtom)
  const reduceTransparent = useAtomValue(reduceTransparentAtom)
  const [productAnalytic, setProductAnalytic] = useAtom(productAnalyticAtom)
  const [productAnalyticPrompt, setProductAnalyticPrompt] = useAtom(
    productAnalyticPromptAtom
  )
  const showScrollBar = useAtomValue(showScrollBarAtom)
  const [showProductAnalyticPrompt, setShowProductAnalyticPrompt] =
    useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (productAnalyticPrompt) {
        setShowProductAnalyticPrompt(true)
      }
      return () => clearTimeout(timer)
    }, 3000) // 3 seconds delay

    return () => clearTimeout(timer) // Cleanup timer on unmount
  }, [productAnalyticPrompt])

  useEffect(() => {
    if (productAnalytic) {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        person_profiles: 'always',
        persistence: 'localStorage',
        opt_out_capturing_by_default: true,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        sanitize_properties: function (properties) {
          const denylist = [
            '$pathname',
            '$initial_pathname',
            '$current_url',
            '$initial_current_url',
            '$host',
            '$initial_host',
            '$initial_person_info',
          ]

          denylist.forEach((key) => {
            if (properties[key]) {
              properties[key] = null // Set each denied property to null
            }
          })

          return properties
        },
      })
      // Attempt to restore distinct Id from app global settings
      getAppDistinctId()
        .then((id) => {
          if (id) posthog.identify(id)
        })
        .finally(() => {
          posthog.opt_in_capturing()
          posthog.register({ app_version: VERSION })
          updateDistinctId(posthog.get_distinct_id())
        })
    } else {
      posthog.opt_out_capturing()
    }
  }, [productAnalytic])

  useEffect(() => {
    if (localStorage.getItem(SUCCESS_SET_NEW_DESTINATION) === 'true') {
      setMainViewState(MainViewState.Settings)
    }
  }, [setMainViewState])

  useEffect(() => {
    window.electronAPI?.onMainViewStateChange(
      (_event: string, route: string) => {
        if (route === 'Settings') {
          setMainViewState(MainViewState.Settings)
        }
      }
    )
  }, [setMainViewState])

  const handleProductAnalytics = (isAllowed: boolean) => {
    setProductAnalytic(isAllowed)
    setProductAnalyticPrompt(false)
    setShowProductAnalyticPrompt(false)
    if (isAllowed) {
      posthog.opt_in_capturing()
    } else {
      posthog.opt_out_capturing()
    }
  }

  return (
    <div
      className={twMerge(
        'h-screen text-sm',
        reduceTransparent
          ? 'bg-[hsla(var(--app-bg))]'
          : 'bg-[hsla(var(--app-transparent))]'
      )}
    >
      <TopPanel />
      <div
        className={twMerge(
          'relative top-9 flex h-[calc(100vh-(36px+36px))] w-screen',
          showScrollBar && 'show-scroll-bar'
        )}
      >
        <RibbonPanel />
        <MainViewContainer />
        <LoadingModal />
        {importModelStage === 'SELECTING_MODEL' && <SelectingModelModal />}
        {importModelStage === 'MODEL_SELECTED' && <ImportModelOptionModal />}
        {importModelStage === 'IMPORTING_MODEL' && <ImportingModelModal />}
        {importModelStage === 'EDIT_MODEL_INFO' && <EditModelInfoModal />}
        {importModelStage === 'CONFIRM_CANCEL' && <CancelModelImportModal />}
        <ChooseWhatToImportModal />
        {showProductAnalyticPrompt && (
          <div className="fixed bottom-4 z-50 m-4 max-w-full rounded-xl border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] p-6 shadow-2xl sm:bottom-8 sm:right-4 sm:m-0 sm:max-w-[400px]">
            <div className="mb-4 flex items-center gap-x-2">
              <svg
                width="32"
                height="32"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M5.5 12.5C5.5 11.1193 6.61929 10 8 10H24C25.3807 10 26.5 11.1193 26.5 12.5V18.5C26.5 24.299 21.799 29 16 29C10.201 29 5.5 24.299 5.5 18.5V12.5Z"
                  fill="#2563EB"
                />
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M8.20959 25.54L12.0093 10H14.0093L9.84984 27.0113C9.25274 26.579 8.70292 26.0855 8.20959 25.54ZM11.5993 28.0361C11.2955 27.8957 10.9996 27.7412 10.7124 27.5734L15.0093 10H16.0093L11.5993 28.0361Z"
                  fill="white"
                />
                <path
                  d="M21 8C21 6.67392 20.4732 5.40215 19.5355 4.46447C18.5979 3.52678 17.3261 3 16 3C14.6739 3 13.4021 3.52678 12.4645 4.46447C11.5268 5.40215 11 6.67392 11 8"
                  stroke="#2563EB"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M27.0478 18.054C27.609 18.5733 27.609 19.4267 27.0478 19.946C25.221 21.6363 20.9622 25 16 25C11.0378 25 6.77899 21.6363 4.95219 19.946C4.39099 19.4267 4.39099 18.5733 4.95219 18.054C6.77899 16.3637 11.0378 13 16 13C20.9622 13 25.221 16.3637 27.0478 18.054Z"
                  fill="#C8D1EA"
                />
                <circle cx="16" cy="19" r="4" fill="#2563EB" />
                <path
                  d="M19.25 17.5C19.9404 17.5 20.5 16.9404 20.5 16.25C20.5 15.5596 19.9404 15 19.25 15C18.5596 15 18 15.5596 18 16.25C18 16.9404 18.5596 17.5 19.25 17.5Z"
                  fill="white"
                />
                <path
                  d="M17.75 18.5C18.1642 18.5 18.5 18.1642 18.5 17.75C18.5 17.3358 18.1642 17 17.75 17C17.3358 17 17 17.3358 17 17.75C17 18.1642 17.3358 18.5 17.75 18.5Z"
                  fill="white"
                />
              </svg>

              <h6 className="text-base font-semibold">Help Us Improve Jan</h6>
            </div>
            <p className="text-[hsla(var(--text-secondary))]">
              To improve Jan, we collect anonymous data to understand feature
              usage. Your chats and personal information are never tracked. You
              can change this anytime in&nbsp;
              <span className="font-semibold">{`Settings > Privacy.`}</span>
            </p>
            <p className="mt-6 text-[hsla(var(--text-secondary))]">
              Would you like to help us to improve Jan?
            </p>
            <div className="mt-6 flex items-center gap-x-2">
              <Button
                onClick={() => {
                  handleProductAnalytics(true)
                }}
              >
                Allow
              </Button>
              <Button
                data-testid="btn-deny-product-analytics"
                theme="ghost"
                variant="outline"
                onClick={() => {
                  handleProductAnalytics(false)
                }}
              >
                Deny
              </Button>
            </div>
          </div>
        )}
      </div>
      <BottomPanel />
      <ModalAppUpdaterChangelog />
      <ModalAppUpdaterNotAvailable />
    </div>
  )
}

export default BaseLayout
