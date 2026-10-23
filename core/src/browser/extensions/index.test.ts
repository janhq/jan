import { describe, test, expect } from 'vitest'
import { InferenceExtension } from './index';
import * as Engines from './index';

describe('index.ts exports', () => {
  test('should export InferenceExtension', () => {
    expect(InferenceExtension).toBeDefined();
  });


  test('should export Engines', () => {
    expect(Engines).toBeDefined();
  });
});
