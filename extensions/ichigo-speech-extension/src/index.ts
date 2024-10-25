import React from 'react'
import { BaseExtension, UIManager, UIComponent, events } from '@janhq/core'
import ReactDOM from 'react-dom/client'
import { LouisView, AshleyView } from './TabView'
import { RecordAudio } from './RecordAudio'
import { AudioLinesIcon } from 'lucide-react'

export default class IchigoSpeechExtension extends BaseExtension {
  async onLoad() {
    UIManager.instance().register(UIComponent.Tab, {
      name: 'Louis Tab',
      value: 'louis',
      render: this.createRootRenderer(LouisView),
    })

    UIManager.instance().register(UIComponent.Tab, {
      name: 'Ashley Tab',
      value: 'ashley',
      render: this.createRootRenderer(AshleyView),
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
