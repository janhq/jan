import { ChatMessage } from '../_models/ChatMessage'

/**
 * Util function to merge two array of messages and remove duplicates.
 * Also preserve the order
 *
 * @param arr1 Message array 1
 * @param arr2 Message array 2
 * @returns Merged array of messages
 */
export function mergeAndRemoveDuplicates(
  arr1: ChatMessage[],
  arr2: ChatMessage[]
): ChatMessage[] {
  const mergedArray = arr1.concat(arr2)
  const uniqueIdMap = new Map<string, boolean>()
  const result: ChatMessage[] = []

  for (const message of mergedArray) {
    if (!uniqueIdMap.has(message.id)) {
      uniqueIdMap.set(message.id, true)
      result.push(message)
    }
  }

  return result.reverse()
}
