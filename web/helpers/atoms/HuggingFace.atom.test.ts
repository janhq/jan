
import { importHuggingFaceModelStageAtom } from './HuggingFace.atom';
import { importingHuggingFaceRepoDataAtom } from './HuggingFace.atom';

test('importHuggingFaceModelStageAtom should have initial value of NONE', () => {
  const result = importHuggingFaceModelStageAtom.init;
  expect(result).toBe('NONE');
});


test('importingHuggingFaceRepoDataAtom should have initial value of undefined', () => {
  const result = importingHuggingFaceRepoDataAtom.init;
  expect(result).toBeUndefined();
});
