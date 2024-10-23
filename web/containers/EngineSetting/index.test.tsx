import { render } from '@testing-library/react'
import '@testing-library/jest-dom'
import EngineSetting from './index'
import SettingComponentBuilder from '@/containers/ModelSetting/SettingComponent'
import { SettingComponentProps } from '@janhq/core'

// Mock the SettingComponentBuilder component
jest.mock('@/containers/ModelSetting/SettingComponent', () =>
  jest.fn(() => null)
)

describe('EngineSetting', () => {
  const mockComponentData: SettingComponentProps[] = [
    {
      key: 'setting1',
      title: 'Setting 1',
      description: 'This is the first setting.',
      controllerType: 'input',
      controllerProps: {
        placeholder: 'Enter text',
        value: 'default text',
        type: 'text',
      },
    },
    {
      key: 'setting2',
      title: 'Setting 2',
      description: 'This is the second setting.',
      controllerType: 'slider',
      controllerProps: {
        min: 0,
        max: 100,
        step: 1,
        value: 50,
      },
    },
    {
      key: 'setting3',
      title: 'Setting 3',
      description: 'This is the third setting.',
      controllerType: 'checkbox',
      controllerProps: {
        value: true,
      },
    },
  ]

  const onValueChangedMock = jest.fn()

  afterEach(() => {
    jest.clearAllMocks() // Clear mocks after each test
  })

  it('renders SettingComponentBuilder with the correct props', () => {
    render(
      <EngineSetting
        componentData={mockComponentData}
        onValueChanged={onValueChangedMock}
        disabled={false}
      />
    )

    // Check that SettingComponentBuilder is called with the correct props
    expect(SettingComponentBuilder).toHaveBeenCalledWith(
      {
        componentProps: mockComponentData,
        disabled: false,
        onValueUpdated: onValueChangedMock,
      },
      {}
    )
  })

  it('renders SettingComponentBuilder with disabled prop', () => {
    render(
      <EngineSetting
        componentData={mockComponentData}
        onValueChanged={onValueChangedMock}
        disabled={true}
      />
    )

    // Check that SettingComponentBuilder is called with disabled=true
    expect(SettingComponentBuilder).toHaveBeenCalledWith(
      {
        componentProps: mockComponentData,
        disabled: true,
        onValueUpdated: onValueChangedMock,
      },
      {}
    )
  })

  it('calls onValueChanged when the value is updated', () => {
    // Simulating value update in SettingComponentBuilder
    ;(SettingComponentBuilder as jest.Mock).mockImplementation(
      ({ onValueUpdated }) => {
        // Simulate calling the value update handler
        onValueUpdated('setting1', 'new value')
        return null
      }
    )

    render(
      <EngineSetting
        componentData={mockComponentData}
        onValueChanged={onValueChangedMock}
        disabled={false}
      />
    )

    // Assert that onValueChanged is called with the correct parameters
    expect(onValueChangedMock).toHaveBeenCalledWith('setting1', 'new value')
  })
})
