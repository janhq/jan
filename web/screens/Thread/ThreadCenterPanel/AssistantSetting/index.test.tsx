// ./AssistantSetting.test.tsx
import '@testing-library/jest-dom'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue, useSetAtom } from 'jotai'
import { useActiveModel } from '@/hooks/useActiveModel'
import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import AssistantSetting from './index'
import { activeThreadAtom } from '@/helpers/atoms/Thread.atom'
import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'

jest.mock('jotai', () => {
  const originalModule = jest.requireActual('jotai')
  return {
    ...originalModule,
    useAtomValue: jest.fn(),
    useSetAtom: jest.fn(),
  }
})
jest.mock('@/hooks/useActiveModel')
jest.mock('@/hooks/useCreateNewThread')
jest.mock('./../../../../containers/ModelSetting/SettingComponent', () => {
  return jest.fn().mockImplementation(({ onValueUpdated }) => {
    return (
      <input
        type="number"
        data-testid="input"
        onChange={(e) => onValueUpdated('chunk_size', e.target.value)}
      />
    )
  })
})

describe('AssistantSetting Component', () => {
  const mockActiveThread = {
    id: '123',
    assistants: [
      {
        id: '456',
        tools: [
          {
            type: 'retrieval',
            enabled: true,
            settings: {
              chunk_size: 100,
              chunk_overlap: 50,
            },
          },
        ],
      },
    ],
  }
  const ComponentPropsMock: any[] = [
    {
      key: 'chunk_size',
      type: 'number',
      title: 'Chunk Size',
      value: 100,
      controllerType: 'input',
    },
    {
      key: 'chunk_overlap',
      type: 'number',
      title: 'Chunk Overlap',
      value: 50,
      controllerType: 'input',
    },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  test('renders AssistantSetting component with proper data', async () => {
    const setEngineParamsUpdate = jest.fn()
    ;(useSetAtom as jest.Mock).mockImplementationOnce(
      () => setEngineParamsUpdate
    )
    ;(useAtomValue as jest.Mock).mockImplementation((atom) => {
      switch (atom) {
        case activeThreadAtom:
          return mockActiveThread
        case activeAssistantAtom:
          return {}
      }
    })
    const updateThreadMetadata = jest.fn()
    ;(useActiveModel as jest.Mock).mockReturnValueOnce({ stopModel: jest.fn() })
    ;(useCreateNewThread as jest.Mock).mockReturnValueOnce({
      updateThreadMetadata,
    })

    render(<AssistantSetting componentData={ComponentPropsMock} />)

    await waitFor(() => {
      const firstInput = screen.getByTestId('input')
      expect(firstInput).toBeInTheDocument()

      userEvent.type(firstInput, '200')
      expect(updateThreadMetadata).toHaveBeenCalled()
      expect(setEngineParamsUpdate).toHaveBeenCalledTimes(0)
    })
  })

  test('triggers model reload with onValueChanged', async () => {
    const setEngineParamsUpdate = jest.fn()
    const updateThreadMetadata = jest.fn()
    const stopModel = jest.fn()
    ;(useAtomValue as jest.Mock).mockImplementation((atom) => {
      switch (atom) {
        case activeThreadAtom:
          return mockActiveThread
        case activeAssistantAtom:
          return {}
      }
    })
    ;(useSetAtom as jest.Mock).mockImplementation(() => setEngineParamsUpdate)
    ;(useActiveModel as jest.Mock).mockReturnValueOnce({ stopModel })
    ;(useCreateNewThread as jest.Mock).mockReturnValueOnce({
      updateThreadMetadata,
    })
    ;(useCreateNewThread as jest.Mock).mockReturnValueOnce({
      updateThreadMetadata,
    })

    render(
      <AssistantSetting
        componentData={
          [
            {
              key: 'chunk_size',
              type: 'number',
              title: 'Chunk Size',
              value: 100,
              controllerType: 'input',
              requireModelReload: true,
            },
          ] as any
        }
      />
    )

    await waitFor(() => {
      const firstInput = screen.getByTestId('input')
      expect(firstInput).toBeInTheDocument()

      userEvent.type(firstInput, '200')
      expect(setEngineParamsUpdate).toHaveBeenCalled()
      expect(stopModel).toHaveBeenCalled()
    })
  })
})
