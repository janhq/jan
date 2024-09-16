
import { getCurrentChatMessagesAtom } from './ChatMessage.atom';
import { setConvoMessagesAtom, chatMessages, readyThreadsMessagesAtom } from './ChatMessage.atom';

test('getCurrentChatMessagesAtom returns empty array when no active thread ID', () => {
  const getMock = jest.fn().mockReturnValue(undefined);
  expect(getCurrentChatMessagesAtom.read(getMock)).toEqual([]);
});


test('getCurrentChatMessagesAtom returns empty array when activeThreadId is undefined', () => {
  const getMock = jest.fn().mockReturnValue({
    activeThreadId: undefined,
    chatMessages: {
      threadId: [{ id: 1, content: 'message' }],
    },
  });
  expect(getCurrentChatMessagesAtom.read(getMock)).toEqual([]);
});

test('setConvoMessagesAtom updates chatMessages and readyThreadsMessagesAtom', () => {
  const getMock = jest.fn().mockReturnValue({});
  const setMock = jest.fn();
  const threadId = 'thread1';
  const messages = [{ id: '1', content: 'Hello' }];

  setConvoMessagesAtom.write(getMock, setMock, threadId, messages);

  expect(setMock).toHaveBeenCalledWith(chatMessages, { [threadId]: messages });
  expect(setMock).toHaveBeenCalledWith(readyThreadsMessagesAtom, { [threadId]: true });
});

