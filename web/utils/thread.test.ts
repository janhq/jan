
import { generateThreadId } from './thread';

test('shouldGenerateThreadIdWithCorrectFormat', () => {
  const assistantId = 'assistant123';
  const threadId = generateThreadId(assistantId);
  const regex = /^assistant123_\d{10}$/;
  expect(threadId).toMatch(regex);
});
