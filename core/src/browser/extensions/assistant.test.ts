
import { it, expect } from 'vitest'
import { AssistantExtension } from './assistant';
import { ExtensionTypeEnum } from '../extension';

it('should return the correct type', () => {
  const extension = new AssistantExtension();
  expect(extension.type()).toBe(ExtensionTypeEnum.Assistant);
});
