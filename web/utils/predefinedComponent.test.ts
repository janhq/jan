import { presetConfiguration } from './predefinedComponent'

it('should have correct configuration for prompt_template', () => {
  const config = presetConfiguration['prompt_template']
  expect(config).toEqual({
    key: 'prompt_template',
    title: 'Prompt template',
    description: `A structured format that guides how the model should respond.`,
    controllerType: 'input',
    controllerProps: {
      placeholder: 'Prompt template',
      value: '',
    },
    requireModelReload: true,
    configType: 'setting',
  })
})
