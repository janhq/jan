import { ChatCompletionMessageParam } from 'token.js'
import { ChatCompletionMessageToolCall } from 'openai/resources'
import {
  ChatCompletionContentPart,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartInputAudio
} from 'openai/resources/chat/completions'
import { ThreadMessage } from '@janhq/core'

/**
 * @fileoverview Helper functions for creating chat completion request.
 * These functions are used to create chat completion request objects
 */
export class CompletionMessagesBuilder {
  private messages: ChatCompletionMessageParam[] = []

  constructor(messages: ThreadMessage[], systemInstruction?: string) {
    if (systemInstruction) {
      this.messages.push({
        role: 'system',
        content: systemInstruction,
      })
    }
    this.messages.push(
      ...messages
        .filter((e) => !e.metadata?.error)
        .map<ChatCompletionMessageParam>(
          (msg) =>
            ({
              role: msg.role,
              content:
                msg.role === 'assistant'
                  ? this.normalizeContent(msg.content[0]?.text?.value ?? '.')
                  : (msg.content[0]?.text?.value ?? '.'),
            }) as ChatCompletionMessageParam
        )
    )
  }

  /**
   * Add a user message to the messages array.
   * @param content - The content of the user message.
   */
  addUserMessage(content: string) {
    this.messages.push({
      role: 'user',
      content: content,
    })
  }

  /**
   * Add an assistant message to the messages array.
   * @param content - The content of the assistant message.
   * @param refusal - Optional refusal message.
   * @param calls - Optional tool calls associated with the message.
   */
  addAssistantMessage(
    content: string,
    refusal?: string,
    calls?: ChatCompletionMessageToolCall[]
  ) {
    this.messages.push({
      role: 'assistant',
      content: this.normalizeContent(content),
      refusal: refusal,
      tool_calls: calls,
    })
  }

  /**
   * Add a tool message to the messages array.
   * @param content - The content of the tool message.
   * @param toolCallId - The ID of the tool call associated with the message.
   */
  addToolMessage(content: string, toolCallId: string) {
    this.messages.push({
      role: 'tool',
      content: content,
      tool_call_id: toolCallId,
    })
  }

  /**
   * Add a user message with file content to the messages array.
   * @param textContent - The text content of the message.
   * @param file_data - The base64 encoded file data (optional).
   * @param file_id - The ID of an uploaded file (optional).
   * @param filename - The name of the file (optional).
   */
  addFileContent(
    textContent: string,
    { file_data, file_id, filename }: {
      file_data?: string;
      file_id?: string;
      filename?: string;
    }
  ) {
    const fileContent: ChatCompletionContentPart.File = {
      type: 'file',
      file: {
        ...(file_data && { file_data }),
        ...(file_id && { file_id }),
        ...(filename && { filename }),
      },
    }

    this.messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: textContent,
        },
        fileContent,
      ],
    })
  }


  /**
   * Add a user message with enhanced image content using OpenAI's image interface.
   * @param textContent - The text content of the message.
   * @param imageUrl - The image URL or base64 data URL.
   * @param detail - The detail level for image processing ('auto', 'low', 'high').
   */
  addImageContent(
    textContent: string,
    imageUrl: string,
    detail: 'auto' | 'low' | 'high' = 'auto'
  ) {
    const imageContent: ChatCompletionContentPartImage = {
      type: 'image_url',
      image_url: {
        url: imageUrl,
        detail: detail,
      },
    }

    this.messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: textContent,
        },
        imageContent,
      ],
    })
  }

  /**
   * Add a user message with multiple images and enhanced processing options.
   * @param textContent - The text content of the message.
   * @param images - Array of image objects with URL and detail options.
   */
  addMultiImageContent(
    textContent: string,
    images: Array<{
      url: string;
      detail?: 'auto' | 'low' | 'high';
    }>
  ) {
    const content: ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: textContent,
      },
    ]

    images.forEach(image => {
      content.push({
        type: 'image_url',
        image_url: {
          url: image.url,
          detail: image.detail ?? 'auto',
        },
      })
    })

    this.messages.push({
      role: 'user',
      content: content,
    })
  }

  /**
   * Enhanced method to add mixed content (text, images, files) in a single message.
   * @param textContent - The text content of the message.
   * @param attachments - Array of mixed content attachments.
   */
  addMixedContent(
    textContent: string,
    attachments: Array<{
      type: 'image' | 'file';
      url?: string;
      detail?: 'auto' | 'low' | 'high';
      file_data?: string;
      file_id?: string;
      filename?: string;
    }>
  ) {
    const content: ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: textContent,
      },
    ]

    attachments.forEach(attachment => {
      if (attachment.type === 'image' && attachment.url) {
        content.push({
          type: 'image_url',
          image_url: {
            url: attachment.url,
            detail: attachment.detail ?? 'auto',
          },
        } as ChatCompletionContentPartImage)
      } else if (attachment.type === 'file') {
        content.push({
          type: 'file',
          file: {
            ...(attachment.file_data && { file_data: attachment.file_data }),
            ...(attachment.file_id && { file_id: attachment.file_id }),
            ...(attachment.filename && { filename: attachment.filename }),
          },
        } as ChatCompletionContentPart.File)
      }
    })

    this.messages.push({
      role: 'user',
      content: content,
    })
  }

  /**
   * Convert uploaded file data to enhanced image format with processing options.
   * @param file - The uploaded file object.
   * @returns The formatted image URL for OpenAI processing.
   */
  private formatImageUrl(
    file: {
      name: string;
      type: string;
      base64: string;
      dataUrl: string;
    }
  ): string {
    // Use dataUrl if available, otherwise construct from base64
    return file.dataUrl || `data:${file.type};base64,${file.base64}`
  }

  /**
   * Check if a file is an image based on its MIME type.
   * @param mimeType - The MIME type of the file.
   * @returns True if the file is an image.
   */
  private isImageFile(mimeType: string): boolean {
    return mimeType.startsWith('image/')
  }

  /**
   * Check if a file is an audio file based on its MIME type.
   * @param mimeType - The MIME type of the file.
   * @returns True if the file is an audio file.
   */
  private isAudioFile(mimeType: string): boolean {
    return mimeType.startsWith('audio/') ||
      mimeType === 'audio/mpeg' ||
      mimeType === 'audio/wav' ||
      mimeType === 'audio/mp3' ||
      mimeType === 'audio/wave'
  }

  /**
   * Get the OpenAI-compatible audio format from MIME type.
   * @param mimeType - The MIME type of the audio file.
   * @returns The OpenAI audio format ('wav' or 'mp3') or null if not supported.
   */
  private getAudioFormat(mimeType: string): 'wav' | 'mp3' | null {
    const audioFormatMap: Record<string, 'wav' | 'mp3'> = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/wave': 'wav',
      'audio/x-wav': 'wav',
    }

    // Early return for known formats
    if (audioFormatMap[mimeType]) {
      return audioFormatMap[mimeType]
    }

    // Fallback for unknown audio types
    return mimeType.startsWith('audio/') ? 'mp3' : null
  }

  /**
   * Add a user message with audio content using OpenAI's audio interface.
   * @param textContent - The text content of the message.
   * @param audioData - The base64 encoded audio data.
   * @param format - The audio format ('wav' or 'mp3').
   */
  addAudioContent(
    textContent: string,
    audioData: string,
    format: 'wav' | 'mp3'
  ) {
    const audioContent: ChatCompletionContentPartInputAudio = {
      type: 'input_audio',
      input_audio: {
        data: audioData,
        format: format,
      },
    }

    this.messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: textContent,
        },
        audioContent,
      ],
    })
  }

  /**
   * Add a user message with multiple audio files.
   * @param textContent - The text content of the message.
   * @param audioFiles - Array of audio objects with data and format.
   */
  addMultiAudioContent(
    textContent: string,
    audioFiles: Array<{
      data: string;
      format: 'wav' | 'mp3';
      description?: string;
    }>
  ) {
    const content: ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: textContent,
      },
    ]

    audioFiles.forEach((audio, index) => {
      // Add optional description for each audio file
      if (audio.description) {
        content.push({
          type: 'text',
          text: `Audio ${index + 1}: ${audio.description}`,
        })
      }

      content.push({
        type: 'input_audio',
        input_audio: {
          data: audio.data,
          format: audio.format,
        },
      } as ChatCompletionContentPartInputAudio)
    })

    this.messages.push({
      role: 'user',
      content: content,
    })
  }

  /**
   * Enhanced method to handle uploaded files with automatic image and audio detection.
   * @param textContent - The text content of the message.
   * @param uploadedFiles - Array of uploaded file objects.
   * @param imageDetail - Default detail level for image processing.
   */
  addUploadedFiles(
    textContent: string,
    uploadedFiles: Array<{
      name: string;
      type: string;
      size: number;
      base64: string;
      dataUrl: string;
    }>,
    imageDetail: 'auto' | 'low' | 'high' = 'auto'
  ) {
    const content: ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: textContent,
      },
    ]

    uploadedFiles.forEach(file => {
      const processedContent = this.processUploadedFile(file, imageDetail)
      content.push(processedContent)
    })

    this.messages.push({
      role: 'user',
      content: content,
    })
  }

  /**
   * Process a single uploaded file and return the appropriate content part.
   * @param file - The uploaded file object.
   * @param imageDetail - Detail level for image processing.
   * @returns The processed content part.
   */
  private processUploadedFile(
    file: {
      name: string;
      type: string;
      size: number;
      base64: string;
      dataUrl: string;
    },
    imageDetail: 'auto' | 'low' | 'high'
  ): ChatCompletionContentPart {
    if (this.isImageFile(file.type)) {
      return this.createImageContentPart(file, imageDetail)
    }

    if (this.isAudioFile(file.type)) {
      return this.createAudioContentPart(file)
    }

    if (this.isPDFFile(file.type)) {
      return this.createPDFContentPart(file)
    }

    return this.createFileContentPart(file)
  }

  /**
   * Create a PDF content part with simple base64 encoding.
   * @param file - The uploaded PDF file.
   * @returns PDF content part with base64 encoding.
   */
  private createPDFContentPart(
    file: {
      name: string;
      type: string;
      base64: string;
    }
  ): ChatCompletionContentPart.File {
    return {
      type: 'file',
      file: {
        filename: file.name,
        file_data: `data:application/pdf;base64,${file.base64}`,
      },
    }
  }

  /**
   * Create an image content part for uploaded image files.
   * @param file - The uploaded image file.
   * @param imageDetail - Detail level for image processing.
   * @returns Image content part.
   */
  private createImageContentPart(
    file: {
      name: string;
      type: string;
      base64: string;
      dataUrl: string;
    },
    imageDetail: 'auto' | 'low' | 'high'
  ): ChatCompletionContentPartImage {
    return {
      type: 'image_url',
      image_url: {
        url: this.formatImageUrl(file),
        detail: imageDetail,
      },
    }
  }

  /**
   * Create an audio content part for uploaded audio files.
   * @param file - The uploaded audio file.
   * @returns Audio content part or regular file content part if format not supported.
   */
  private createAudioContentPart(
    file: {
      name: string;
      type: string;
      base64: string;
    }
  ): ChatCompletionContentPartInputAudio | ChatCompletionContentPart.File {
    const audioFormat = this.getAudioFormat(file.type)

    if (!audioFormat) {
      // Early return for unsupported audio formats
      return this.createFileContentPart(file)
    }

    return {
      type: 'input_audio',
      input_audio: {
        data: file.base64,
        format: audioFormat,
      },
    }
  }

  /**
   * Create a regular file content part for non-media files.
   * @param file - The uploaded file.
   * @returns File content part.
   */
  private createFileContentPart(
    file: {
      name: string;
      type: string;
      base64: string;
    }
  ): ChatCompletionContentPart.File {
    const fileData = this.isPDFFile(file.type)
      ? `data:application/pdf;base64,${file.base64}`
      : file.base64

    return {
      type: 'file',
      file: {
        file_data: fileData,
        filename: file.name,
      },
    }
  }

  /**
   * Check if a file is a PDF based on its MIME type.
   * @param mimeType - The MIME type of the file.
   * @returns True if the file is a PDF.
   */
  private isPDFFile(mimeType: string): boolean {
    return mimeType === 'application/pdf'
  }

  /**
   * Return the messages array.
   * @returns The array of chat completion messages.
   */
  getMessages(): ChatCompletionMessageParam[] {
    return this.messages
  }

  /**
   * Normalize the content of a message by removing reasoning content.
   * This is useful to ensure that reasoning content does not get sent to the model.
   * @param content
   * @returns
   */
  private normalizeContent = (content: string): string => {
    // Reasoning content should not be sent to the model
    if (content.includes('<think>')) {
      const match = content.match(/<think>([\s\S]*?)<\/think>/)
      if (match?.index !== undefined) {
        const splitIndex = match.index + match[0].length
        content = content.slice(splitIndex).trim()
      }
    }
    return content
  }
}
