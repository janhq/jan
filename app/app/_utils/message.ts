import { ChatMessage } from "../_models/ChatMessage";

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
  const mergedArray = arr1.concat(arr2);
  const uniqueIdMap = new Map<string, boolean>();
  const result: ChatMessage[] = [];

  for (const message of mergedArray) {
    if (!uniqueIdMap.has(message.id)) {
      uniqueIdMap.set(message.id, true);
      result.push(message);
    }
  }

  return result.reverse();
}

export function getMessageCode(stringCode: string) {
  const blocks = stringCode.split("```");

  const resultArray = [];

  for (let i = 0; i < blocks.length; i += 2) {
    const text = blocks[i] ? blocks[i].trim() : "";
    const code = blocks[i + 1] ? blocks[i + 1].trim() : "";
    if (text || code) {
      resultArray.push({ text, code });
    }
  }
  return resultArray;
}
