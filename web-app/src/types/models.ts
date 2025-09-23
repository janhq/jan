/**
 * Model capabilities
 * @description This enum defines the capabilities of a model.
 * @enum {string}
 */
export enum ModelCapabilities {
  COMPLETION = 'completion',
  TOOLS = 'tools',
  EMBEDDINGS = 'embeddings',
  IMAGE_GENERATION = 'image_generation',
  AUDIO_GENERATION = 'audio_generation',
  TEXT_TO_IMAGE = 'text_to_image',
  IMAGE_TO_IMAGE = 'image_to_image',
  TEXT_TO_AUDIO = 'text_to_audio',
  AUDIO_TO_TEXT = 'audio_to_text',
  // Need to consolidate the capabilities list
  VISION = 'vision',
}
