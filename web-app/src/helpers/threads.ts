/**
 * @fileoverview Helper functions for creating thread content.
 * These functions are used to create thread content objects
 * for different types of content, such as text and image.
 * The functions return objects that conform to the `ThreadContent` type.
 * @param content - The content of the thread
 * @returns
 */
export const newUserThreadContent = (content: string): ThreadContent => ({
  type: 'text',
  role: 'user',
  text: {
    value: content,
    annotations: [],
  },
  
})
/**
 * @fileoverview Helper functions for creating thread content.
 * These functions are used to create thread content objects
 * for different types of content, such as text and image.
 * The functions return objects that conform to the `ThreadContent` type.
 * @param content - The content of the thread
 * @returns
 */
export const newAssistantThreadContent = (content: string): ThreadContent => ({
  type: 'text',
  role: 'assistant',
  text: {
    value: content,
    annotations: [],
  },
})
