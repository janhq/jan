
import { presetConfiguration } from './predefinedComponent';

it('should have correct configuration for prompt_template', () => {
  const config = presetConfiguration['prompt_template'];
  expect(config).toEqual({
    key: 'prompt_template',
    title: 'Prompt template',
    description: `A predefined text or framework that guides the AI model's response generation. It includes placeholders or instructions for the model to fill in or expand upon.`,
    controllerType: 'input',
    controllerProps: {
      placeholder: 'Prompt template',
      value: '',
    },
    requireModelReload: true,
    configType: 'setting',
  });
});
