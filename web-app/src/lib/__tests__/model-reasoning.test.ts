import { describe, expect, it } from 'vitest'
import {
  applyModelReasoningUpdate,
  getModelReasoningLabel,
  getModelReasoningOptions,
  getModelReasoningValue,
  isDefaultReasoningSetting,
  modelSupportsReasoningControl,
} from '@/lib/model-reasoning'
import { modelSettings } from '@/lib/predefined'

describe('model-reasoning', () => {
  it('reads reasoning options from the model card config', () => {
    const model = {
      id: 'grok-3',
      settings: {
        reasoning: {
          key: 'reasoning',
          title: 'Thinking effort',
          description: 'How hard the model should think.',
          controller_type: 'dropdown',
          controller_props: {
            value: 'high',
            options: [
              { value: 'low', name: 'Low' },
              { value: 'high', name: 'High' },
            ],
          },
        },
      },
    } as Model

    expect(getModelReasoningOptions(model)).toEqual([
      {
        value: 'low',
        label: 'Low',
        title: 'How hard the model should think.',
      },
      {
        value: 'high',
        label: 'High',
        title: 'How hard the model should think.',
      },
    ])
    expect(getModelReasoningValue(model)).toBe('high')
    expect(getModelReasoningLabel(model)).toBe('High')
    expect(modelSupportsReasoningControl(model)).toBe(true)
  })

  it('does not show reasoning controls without model card dropdown config', () => {
    expect(modelSupportsReasoningControl({ id: 'gpt-4o' })).toBe(false)
    expect(
      modelSupportsReasoningControl({
        id: 'qwen',
        settings: {
          reasoning: {
            ...modelSettings.reasoning,
            controller_type: 'input',
            controller_props: { value: 'on' },
          },
        },
      })
    ).toBe(false)
  })

  it('detects the default reasoning template', () => {
    expect(isDefaultReasoningSetting(modelSettings.reasoning)).toBe(true)
    expect(
      isDefaultReasoningSetting({
        ...modelSettings.reasoning,
        controller_props: {
          value: 'high',
          options: [{ value: 'high', name: 'High' }],
        },
      })
    ).toBe(false)
  })

  it('applyModelReasoningUpdate persists per-model reasoning', () => {
    const provider = {
      provider: 'xai',
      models: [
        {
          id: 'grok-3',
          settings: {
            reasoning: {
              key: 'reasoning',
              title: 'Thinking effort',
              description: 'Choose effort',
              controller_type: 'dropdown',
              controller_props: {
                value: 'low',
                options: [
                  { value: 'low', name: 'Low' },
                  { value: 'high', name: 'High' },
                ],
              },
            },
          },
        },
      ],
    } as ModelProvider

    const updated = applyModelReasoningUpdate(provider, 'grok-3', 'high')
    expect(updated?.models[0].settings?.reasoning?.controller_props?.value).toBe(
      'high'
    )
  })
})