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
import Responsive from './Responsive'

import SWRConfigProvider from './SWRConfigProvider'
import SettingsHandler from './SettingsHandler'

const Providers = ({ children }: PropsWithChildren) => {
  return (
    <SWRConfigProvider>
      <ThemeWrapper>
        <JotaiWrapper>
          <CoreConfigurator>
            <>
              <Responsive />
              <KeyListener />
              <EventListener />
              <DataLoader />
              <SettingsHandler />
              <DeepLinkListener />
              <Toaster />
              {children}
            </>
          </CoreConfigurator>
        </JotaiWrapper>
      </ThemeWrapper>
    </SWRConfigProvider>
  )
}

export default Providers
