'use client'

import { PropsWithChildren } from 'react'

import { Toaster } from 'react-hot-toast'

import EventListener from '@/containers/Providers/EventListener'
import JotaiWrapper from '@/containers/Providers/Jotai'

import ThemeWrapper from '@/containers/Providers/Theme'

import { CoreConfigurator } from './CoreConfigurator'
import DataLoader from './DataLoader'

import DeepLinkListener from './DeepLinkListener'
import KeyListener from './KeyListener'
import { QuickAskConfigurator } from './QuickAskConfigurator'
import Responsive from './Responsive'

import SWRConfigProvider from './SWRConfigProvider'
import SettingsHandler from './SettingsHandler'

const Providers = ({ children }: PropsWithChildren) => {
  const isQuickAsk =
    typeof window !== 'undefined' && window.electronAPI?.isQuickAsk()
  return (
    <SWRConfigProvider>
      <ThemeWrapper>
        <JotaiWrapper>
          {isQuickAsk && (
            <>
              <QuickAskConfigurator> {children} </QuickAskConfigurator>
            </>
          )}
          {!isQuickAsk && (
            <CoreConfigurator>
              <>
                <Responsive />
                <KeyListener />
                <EventListener />
                <DataLoader />
                <SettingsHandler />
                <DeepLinkListener />
                <Toaster />
                <div className={'draggable-bar h-[32px]'} />
                {children}
              </>
            </CoreConfigurator>
          )}
        </JotaiWrapper>
      </ThemeWrapper>
    </SWRConfigProvider>
  )
}

export default Providers
