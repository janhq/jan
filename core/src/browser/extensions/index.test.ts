import { ConversationalExtension } from './index';
import { InferenceExtension } from './index';
import { AssistantExtension } from './index';
import { ModelExtension } from './index';
import * as Engines from './index';

describe('index.ts exports', () => {
  test('should export ConversationalExtension', () => {
    expect(ConversationalExtension).toBeDefined();
  });

  test('should export InferenceExtension', () => {
    expect(InferenceExtension).toBeDefined();
  });

  test('should export AssistantExtension', () => {
    expect(AssistantExtension).toBeDefined();
  });

  test('should export ModelExtension', () => {
    expect(ModelExtension).toBeDefined();
  });

  test('should export Engines', () => {
    expect(Engines).toBeDefined();
  });
});
