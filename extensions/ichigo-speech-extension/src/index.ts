import React from 'react'
import { BaseExtension, UIManager, UIComponent, events } from '@janhq/core'
import ReactDOM from 'react-dom/client'
import { CodePreviewTab, SetupView } from './TabView'
import { RecordAudio } from './RecordAudio'
import { AudioLinesIcon } from 'lucide-react'

export default class IchigoSpeechExtension extends BaseExtension {
  async onLoad() {
    UIManager.instance().register(UIComponent.Tab, {
      name: 'Code Preview',
      value: 'code_preview',
      render: this.createRootRenderer(CodePreviewTab),
    })

    UIManager.instance().register(UIComponent.Tab, {
      name: 'Keys Setup',
      value: 'keys_setup',
      render: this.createRootRenderer(SetupView),
    })

    UIManager.instance().register(UIComponent.InputChatBox, {
      name: 'ichigo-speech',
      icon: AudioLinesIcon,
      render: this.createRootRenderer(RecordAudio),
      onClick: () => {
        this.handleClick()
      },
    })
  }

  // Handle click and emit the event
  handleClick() {
    console.log('Microphone icon clicked!')
    events.emit('showComponent', { component: 'RecordAudio' }) // Emit event for component rendering
  }

  createRootRenderer(Component: React.ComponentType) {
    return (container: HTMLElement) => {
      const root = ReactDOM.createRoot(container)
      root.render(React.createElement(Component))
    }
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload(): void {}
}
