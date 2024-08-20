import { closeSync, openSync, readSync } from 'fs'
import { Template } from '@huggingface/jinja'
/**
 * This is to retrieve the metadata from a GGUF file
 * It uses hyllama and jinja from @huggingface module
 */
export const retrieveGGUFMetadata = async (ggufPath: string) => {
  try {
    const { ggufMetadata } = await import('hyllama')
    // Read first 10mb of gguf file
    const fd = openSync(ggufPath, 'r')
    const buffer = new Uint8Array(10_000_000)
    readSync(fd, buffer, 0, 10_000_000, 0)
    closeSync(fd)

    // Parse metadata and tensor info
    const { metadata } = ggufMetadata(buffer.buffer)

    const template = new Template(metadata['tokenizer.chat_template'])
    const eos_id = metadata['tokenizer.ggml.eos_token_id']
    const bos_id = metadata['tokenizer.ggml.bos_token_id']
    const eos_token = metadata['tokenizer.ggml.tokens'][eos_id]
    const bos_token = metadata['tokenizer.ggml.tokens'][bos_id]
    // Parse jinja template
    const renderedTemplate = template.render({
      add_generation_prompt: true,
      eos_token,
      bos_token,
      messages: [
        {
          role: 'system',
          content: '{system_message}',
        },
        {
          role: 'user',
          content: '{prompt}',
        },
      ],
    })
    return {
      ...metadata,
      parsed_chat_template: renderedTemplate,
    }
  } catch (e) {
    console.log(e)
  }
}
