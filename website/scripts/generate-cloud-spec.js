#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CONFIG = {
  // Jan Server API spec URL - change this for different environments
  JAN_SERVER_SPEC_URL:
    process.env.JAN_SERVER_SPEC_URL ||
    'https://api.jan.ai/api/swagger/doc.json',

  // Server URLs for different environments
  SERVERS: {
    production: {
      url: process.env.JAN_SERVER_PROD_URL || 'https://api.jan.ai/v1',
      description: 'Jan Server API (Production)',
    },
    staging: {
      url:
        process.env.JAN_SERVER_STAGING_URL || 'https://staging-api.jan.ai/v1',
      description: 'Jan Server API (Staging)',
    },
    local: {
      url: process.env.JAN_SERVER_LOCAL_URL || 'http://localhost:8000/v1',
      description: 'Jan Server (Local Development)',
    },
    minikube: {
      url:
        process.env.JAN_SERVER_MINIKUBE_URL ||
        'http://jan-server.local:8000/v1',
      description: 'Jan Server (Minikube)',
    },
  },

  // Output file path
  OUTPUT_PATH: path.join(__dirname, '../public/openapi/cloud-openapi.json'),

  // Fallback to local spec if fetch fails
  FALLBACK_SPEC_PATH: path.join(__dirname, '../public/openapi/openapi.json'),

  // Request timeout in milliseconds
  FETCH_TIMEOUT: 10000,
}

// Model examples for Jan Server (vLLM deployment)
const MODEL_EXAMPLES = [
  'llama-3.1-8b-instruct',
  'mistral-7b-instruct-v0.3',
  'gemma-2-9b-it',
  'qwen2.5-7b-instruct',
]

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bright: '\x1b[1m',
}

function log(message, type = 'info') {
  const prefix =
    {
      success: `${colors.green}✅`,
      warning: `${colors.yellow}⚠️ `,
      error: `${colors.red}❌`,
      info: `${colors.cyan}ℹ️ `,
    }[type] || ''
  console.log(`${prefix} ${message}${colors.reset}`)
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

// =============================================================================
// SPEC ENHANCEMENT FUNCTIONS
// =============================================================================

function enhanceSpecWithBranding(spec) {
  // Update info section with Jan Server branding
  spec.info = {
    ...spec.info,
    'title': '👋Jan Server API',
    'description':
      'OpenAI-compatible API for Jan Server powered by vLLM. High-performance, scalable inference service with automatic batching and optimized memory management.',
    'version': spec.info?.version || '1.0.0',
    'x-logo': {
      url: 'https://jan.ai/logo.png',
      altText: '👋Jan Server API',
    },
    'contact': {
      name: 'Jan Server Support',
      url: 'https://jan.ai/support',
      email: 'support@jan.ai',
    },
    'license': {
      name: 'Apache 2.0',
      url: 'https://github.com/menloresearch/jan/blob/main/LICENSE',
    },
  }

  // Update servers with our configured endpoints
  spec.servers = Object.values(CONFIG.SERVERS)

  // Add global security requirement
  spec.security = [{ bearerAuth: [] }]

  // Add tags for better organization
  spec.tags = [
    { name: 'Models', description: 'List and describe available models' },
    {
      name: 'Chat',
      description: 'Chat completion endpoints for conversational AI',
    },
    { name: 'Completions', description: 'Text completion endpoints' },
    { name: 'Embeddings', description: 'Generate embeddings for text' },
    { name: 'Usage', description: 'Monitor API usage and quotas' },
  ]

  return spec
}

function enhanceSecuritySchemes(spec) {
  if (!spec.components) spec.components = {}
  if (!spec.components.securitySchemes) spec.components.securitySchemes = {}

  spec.components.securitySchemes.bearerAuth = {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'Enter your Jan Server API key. Configure authentication in your server settings.',
  }

  return spec
}

function addModelExamples(spec) {
  const primaryModel = MODEL_EXAMPLES[0]

  // Helper function to update model fields in schemas
  function updateModelField(modelField) {
    if (!modelField) return

    modelField.example = primaryModel
    modelField.description = `ID of the model to use. Available models: ${MODEL_EXAMPLES.join(', ')}`

    if (modelField.anyOf && modelField.anyOf[0]?.type === 'string') {
      modelField.anyOf[0].example = primaryModel
      modelField.anyOf[0].enum = MODEL_EXAMPLES
    } else if (modelField.type === 'string') {
      modelField.enum = MODEL_EXAMPLES
    }
  }

  // Update model fields in common request schemas
  const schemas = spec.components?.schemas || {}

  if (schemas.CreateCompletionRequest?.properties?.model) {
    updateModelField(schemas.CreateCompletionRequest.properties.model)
  }

  if (schemas.CreateChatCompletionRequest?.properties?.model) {
    updateModelField(schemas.CreateChatCompletionRequest.properties.model)
  }

  if (schemas.CreateEmbeddingRequest?.properties?.model) {
    updateModelField(schemas.CreateEmbeddingRequest.properties.model)
  }

  return spec
}

function addRequestExamples(spec) {
  const primaryModel = MODEL_EXAMPLES[0]

  // Example request bodies
  const examples = {
    completion: {
      'text-completion': {
        summary: 'Text Completion Example',
        description: `Complete text using ${primaryModel}`,
        value: {
          model: primaryModel,
          prompt: 'Once upon a time,',
          max_tokens: 50,
          temperature: 0.7,
          top_p: 0.9,
          stream: false,
        },
      },
    },
    chatCompletion: {
      'simple-chat': {
        summary: 'Simple Chat Example',
        description: `Chat completion using ${primaryModel}`,
        value: {
          model: primaryModel,
          messages: [
            { role: 'user', content: 'What is the capital of France?' },
          ],
          max_tokens: 100,
          temperature: 0.7,
          stream: false,
        },
      },
    },
    embedding: {
      'text-embedding': {
        summary: 'Text Embedding Example',
        description: `Generate embeddings using ${primaryModel}`,
        value: {
          model: primaryModel,
          input: 'The quick brown fox jumps over the lazy dog',
        },
      },
    },
  }

  // Add examples to path operations
  Object.keys(spec.paths || {}).forEach((path) => {
    Object.keys(spec.paths[path] || {}).forEach((method) => {
      const operation = spec.paths[path][method]

      if (!operation.requestBody?.content?.['application/json']) return

      if (path.includes('/completions') && !path.includes('/chat')) {
        operation.requestBody.content['application/json'].examples =
          examples.completion
      } else if (path.includes('/chat/completions')) {
        operation.requestBody.content['application/json'].examples =
          examples.chatCompletion
      } else if (path.includes('/embeddings')) {
        operation.requestBody.content['application/json'].examples =
          examples.embedding
      }
    })
  })

  return spec
}

function addCloudFeatures(spec) {
  // Add cloud-specific extension
  spec['x-jan-server-features'] = {
    vllm: {
      version: '0.5.0',
      features: [
        'PagedAttention for efficient memory management',
        'Continuous batching for high throughput',
        'Tensor parallelism for multi-GPU serving',
        'Quantization support (AWQ, GPTQ, SqueezeLLM)',
        'Speculative decoding',
        'LoRA adapter support',
      ],
    },
    scaling: {
      auto_scaling: true,
      min_replicas: 1,
      max_replicas: 100,
      target_qps: 100,
    },
    limits: {
      max_tokens_per_request: 32768,
      max_batch_size: 256,
      timeout_seconds: 300,
    },
  }

  return spec
}

// =============================================================================
// MAIN FUNCTIONS
// =============================================================================

async function fetchJanServerSpec() {
  log(`Fetching Jan Server spec from: ${CONFIG.JAN_SERVER_SPEC_URL}`)

  try {
    const response = await fetchWithTimeout(CONFIG.JAN_SERVER_SPEC_URL)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const spec = await response.json()
    log('Successfully fetched Jan Server specification', 'success')
    return spec
  } catch (error) {
    log(`Failed to fetch Jan Server spec: ${error.message}`, 'warning')

    // If FORCE_UPDATE is set, don't use fallback - fail instead
    if (process.env.FORCE_UPDATE === 'true') {
      log('Force update requested - not using fallback', 'error')
      throw error
    }

    log(`Falling back to local spec: ${CONFIG.FALLBACK_SPEC_PATH}`, 'warning')

    if (fs.existsSync(CONFIG.FALLBACK_SPEC_PATH)) {
      const fallbackSpec = JSON.parse(
        fs.readFileSync(CONFIG.FALLBACK_SPEC_PATH, 'utf8')
      )
      log('Using local fallback specification', 'warning')
      return fallbackSpec
    } else {
      throw new Error('No fallback spec available')
    }
  }
}

async function generateCloudSpec() {
  console.log(
    `${colors.bright}${colors.cyan}🚀 Jan Server API Spec Generator${colors.reset}`
  )
  console.log(
    `${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
  )
  console.log(`📡 Source: ${CONFIG.JAN_SERVER_SPEC_URL}`)
  console.log(`📁 Output: ${CONFIG.OUTPUT_PATH}`)
  console.log(`🏗️  Servers: ${Object.keys(CONFIG.SERVERS).join(', ')}`)
  console.log('')

  try {
    // Fetch the real Jan Server specification
    let spec = await fetchJanServerSpec()

    // Apply all enhancements
    spec = enhanceSpecWithBranding(spec)
    spec = enhanceSecuritySchemes(spec)
    spec = addModelExamples(spec)
    spec = addRequestExamples(spec)
    spec = addCloudFeatures(spec)

    // Ensure all paths have security requirements
    Object.keys(spec.paths || {}).forEach((path) => {
      Object.keys(spec.paths[path] || {}).forEach((method) => {
        const operation = spec.paths[path][method]
        if (!operation.security) {
          operation.security = [{ bearerAuth: [] }]
        }
      })
    })

    // Write the enhanced specification
    fs.writeFileSync(CONFIG.OUTPUT_PATH, JSON.stringify(spec, null, 2), 'utf8')

    log('Jan Server specification generated successfully!', 'success')
    console.log(`📁 Output: ${CONFIG.OUTPUT_PATH}`)
    console.log('\n📊 Summary:')
    console.log(`  - Endpoints: ${Object.keys(spec.paths || {}).length}`)
    console.log(`  - Servers: ${spec.servers?.length || 0}`)
    console.log(`  - Models: ${MODEL_EXAMPLES.length}`)
    console.log(`  - Security: Bearer token authentication`)
    console.log(
      `  - Engine: vLLM (${spec['x-jan-server-features']?.vllm?.version || 'unknown'})`
    )

    return true
  } catch (error) {
    log(
      `Failed to generate Jan Server specification: ${error.message}`,
      'error'
    )
    console.log('\n🔧 Troubleshooting:')
    console.log('  1. Check your internet connection')
    console.log(
      `  2. Verify Jan Server is accessible at: ${CONFIG.JAN_SERVER_SPEC_URL}`
    )
    console.log('  3. Check if you need to set environment variables:')
    console.log('     - JAN_SERVER_SPEC_URL')
    console.log('     - JAN_SERVER_PROD_URL')
    console.log('     - JAN_SERVER_LOCAL_URL')
    return false
  }
}

// =============================================================================
// EXECUTION
// =============================================================================

// Show configuration on startup
if (process.env.NODE_ENV !== 'test') {
  console.log(`${colors.cyan}🔧 Configuration:${colors.reset}`)
  console.log(`  Spec URL: ${CONFIG.JAN_SERVER_SPEC_URL}`)
  console.log(`  Timeout: ${CONFIG.FETCH_TIMEOUT}ms`)
  console.log(`  Servers: ${Object.keys(CONFIG.SERVERS).length} configured`)
  if (process.env.FORCE_UPDATE === 'true') {
    console.log(`  ${colors.yellow}Force Update: ENABLED${colors.reset}`)
  }
  console.log('')
}

// Run the generator
const success = await generateCloudSpec()
process.exit(success ? 0 : 1)
