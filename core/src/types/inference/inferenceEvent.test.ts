

  import { InferenceEvent } from './inferenceEvent';
  
  test('testInferenceEventEnumContainsOnInferenceStopped', () => {
    expect(InferenceEvent.OnInferenceStopped).toBe('OnInferenceStopped');
  });
