/**
 * Model-related constants
 */

export const NEW_JAN_MODEL_HF_REPO = 'janhq/Jan-v3-4B-base-instruct-GGUF'
export const DEFAULT_MODEL_QUANTIZATIONS = ['iq4_xs', 'q4_k_m']

/**
 * Quantizations to check for SetupScreen quick start
 * Includes Q8 for higher quality on capable systems
 */
export const SETUP_SCREEN_QUANTIZATIONS = ['q8_0', 'q4_k_m', 'iq4_xs']
