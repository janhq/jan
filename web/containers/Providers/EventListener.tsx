import { Fragment } from 'react'

import React from 'react'

import AppUpdateListener from './AppUpdateListener'
import ClipboardListener from './ClipboardListener'
import DeepLinkListener from './DeepLinkListener'
import DownloadEventListener from './DownloadEventListener'

import KeyListener from './KeyListener'
import ModelEventListener from './ModelEventListener'

const EventListenerWrapper: React.FC = () => (
  <Fragment>
    <AppUpdateListener />
    <KeyListener />
    <DownloadEventListener />
    <ModelEventListener />
    <ClipboardListener />
    <DeepLinkListener />
  </Fragment>
)

export default EventListenerWrapper
