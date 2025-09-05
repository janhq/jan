#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const cloudSpecPath = path.join(
  __dirname,
  '../public/openapi/cloud-openapi.json'
)
const outputPath = path.join(__dirname, '../public/openapi/openapi.json')

console.log(
  '🔧 Fixing Local OpenAPI Spec with Complete Examples and Schemas...'
)

// Read cloud spec as a reference
const cloudSpec = JSON.parse(fs.readFileSync(cloudSpecPath, 'utf8'))

// Convert Swagger 2.0 to OpenAPI 3.0 format for paths
function convertSwaggerPathToOpenAPI3(swaggerPath) {
  const openApiPath = {}

  Object.keys(swaggerPath || {}).forEach((method) => {
    if (typeof swaggerPath[method] === 'object') {
      openApiPath[method] = {
        ...swaggerPath[method],
        // Convert parameters
        parameters: swaggerPath[method].parameters?.filter(
          (p) => p.in !== 'body'
        ),
        // Convert body parameter to requestBody
        requestBody: swaggerPath[method].parameters?.find(
          (p) => p.in === 'body'
        )
          ? {
              required: true,
              content: {
                'application/json': {
                  schema: swaggerPath[method].parameters.find(
                    (p) => p.in === 'body'
                  ).schema,
                },
              },
            }
          : undefined,
        // Convert responses
        responses: {},
      }

      // Convert responses
      Object.keys(swaggerPath[method].responses || {}).forEach((statusCode) => {
        const response = swaggerPath[method].responses[statusCode]
        openApiPath[method].responses[statusCode] = {
          description: response.description,
          content: response.schema
            ? {
                'application/json': {
                  schema: response.schema,
                },
              }
            : undefined,
        }
      })
    }
  })

  return openApiPath
}

// Create comprehensive local spec
const localSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Jan API',
    description:
      "OpenAI-compatible API for local inference with Jan. Run AI models locally with complete privacy using llama.cpp's high-performance inference engine. Supports GGUF models with CPU and GPU acceleration. No authentication required for local usage.",
    version: '0.3.14',
    contact: {
      name: 'Jan Support',
      url: 'https://jan.ai/support',
      email: 'support@jan.ai',
    },
    license: {
      name: 'Apache 2.0',
      url: 'https://github.com/janhq/jan/blob/main/LICENSE',
    },
  },
  servers: [
    {
      url: 'http://127.0.0.1:1337',
      description: 'Local Jan Server (Default IP)',
    },
    {
      url: 'http://localhost:1337',
      description: 'Local Jan Server (localhost)',
    },
    {
      url: 'http://localhost:8080',
      description: 'Local Jan Server (Alternative Port)',
    },
  ],
  tags: [
    {
      name: 'Models',
      description: 'List and describe available models',
    },
    {
      name: 'Chat',
      description: 'Chat completion endpoints for conversational AI',
    },
    {
      name: 'Completions',
      description: 'Text completion endpoints for generating text',
    },
    {
      name: 'Extras',
      description:
        'Additional utility endpoints for tokenization and text processing',
    },
  ],
  paths: {},
  components: {
    schemas: {},
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Optional: Enter your API key if authentication is enabled. The Bearer prefix will be added automatically.',
      },
    },
  },
}

// Local model examples
const LOCAL_MODELS = [
  'gemma-2-2b-it-Q8_0',
  'llama-3.1-8b-instruct-Q4_K_M',
  'mistral-7b-instruct-v0.3-Q4_K_M',
  'phi-3-mini-4k-instruct-Q4_K_M',
]

// Add completions endpoint with rich examples
localSpec.paths['/v1/completions'] = {
  post: {
    tags: ['Completions'],
    summary: 'Create completion',
    description:
      "Creates a completion for the provided prompt and parameters. This endpoint is compatible with OpenAI's completions API.",
    operationId: 'create_completion',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/CreateCompletionRequest',
          },
          examples: {
            basic: {
              summary: 'Basic Completion',
              description: 'Simple text completion example',
              value: {
                model: LOCAL_MODELS[0],
                prompt: 'Once upon a time',
                max_tokens: 50,
                temperature: 0.7,
              },
            },
            creative: {
              summary: 'Creative Writing',
              description: 'Generate creative content with higher temperature',
              value: {
                model: LOCAL_MODELS[0],
                prompt: 'Write a short poem about coding:',
                max_tokens: 150,
                temperature: 1.0,
                top_p: 0.95,
              },
            },
            code: {
              summary: 'Code Generation',
              description: 'Generate code with lower temperature for accuracy',
              value: {
                model: LOCAL_MODELS[0],
                prompt:
                  '# Python function to calculate fibonacci\ndef fibonacci(n):',
                max_tokens: 200,
                temperature: 0.3,
                stop: ['\n\n', 'def ', 'class '],
              },
            },
            streaming: {
              summary: 'Streaming Response',
              description: 'Stream tokens as they are generated',
              value: {
                model: LOCAL_MODELS[0],
                prompt: 'Explain quantum computing in simple terms:',
                max_tokens: 300,
                temperature: 0.7,
                stream: true,
              },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successful Response',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/CreateCompletionResponse',
            },
          },
        },
      },
      202: {
        description: 'Accepted - Request is being processed',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/CreateCompletionResponse',
            },
          },
          'text/event-stream': {
            schema: {
              type: 'string',
              format: 'binary',
              description: 'Server-sent events stream for streaming responses',
            },
          },
        },
      },
      422: {
        description: 'Validation Error',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ValidationError',
            },
          },
        },
      },
    },
  },
}

// Add chat completions endpoint with rich examples
localSpec.paths['/v1/chat/completions'] = {
  post: {
    tags: ['Chat'],
    summary: 'Create chat completion',
    description:
      "Creates a model response for the given chat conversation. This endpoint is compatible with OpenAI's chat completions API.",
    operationId: 'create_chat_completion',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/CreateChatCompletionRequest',
          },
          examples: {
            simple: {
              summary: 'Simple Chat',
              description: 'Basic question and answer',
              value: {
                model: LOCAL_MODELS[0],
                messages: [
                  {
                    role: 'user',
                    content: 'What is the capital of France?',
                  },
                ],
                max_tokens: 100,
                temperature: 0.7,
              },
            },
            system: {
              summary: 'With System Message',
              description: 'Chat with system instructions',
              value: {
                model: LOCAL_MODELS[0],
                messages: [
                  {
                    role: 'system',
                    content:
                      'You are a helpful assistant that speaks like a pirate.',
                  },
                  {
                    role: 'user',
                    content: 'Tell me about the weather today.',
                  },
                ],
                max_tokens: 150,
                temperature: 0.8,
              },
            },
            conversation: {
              summary: 'Multi-turn Conversation',
              description: 'Extended conversation with context',
              value: {
                model: LOCAL_MODELS[0],
                messages: [
                  {
                    role: 'system',
                    content: 'You are a knowledgeable AI assistant.',
                  },
                  {
                    role: 'user',
                    content: 'What is machine learning?',
                  },
                  {
                    role: 'assistant',
                    content:
                      'Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed.',
                  },
                  {
                    role: 'user',
                    content: 'Can you give me a simple example?',
                  },
                ],
                max_tokens: 200,
                temperature: 0.7,
              },
            },
            streaming: {
              summary: 'Streaming Chat',
              description: 'Stream the response token by token',
              value: {
                model: LOCAL_MODELS[0],
                messages: [
                  {
                    role: 'user',
                    content: 'Write a haiku about programming',
                  },
                ],
                stream: true,
                temperature: 0.9,
              },
            },
            json_mode: {
              summary: 'JSON Response',
              description: 'Request structured JSON output',
              value: {
                model: LOCAL_MODELS[0],
                messages: [
                  {
                    role: 'user',
                    content:
                      'List 3 programming languages with their main use cases in JSON format',
                  },
                ],
                max_tokens: 200,
                temperature: 0.5,
                response_format: {
                  type: 'json_object',
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successful Response',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/CreateChatCompletionResponse',
            },
          },
          'text/event-stream': {
            schema: {
              type: 'string',
              format: 'binary',
              description: 'Server-sent events stream for streaming responses',
            },
          },
        },
      },
      202: {
        description: 'Accepted - Request is being processed',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/CreateChatCompletionResponse',
            },
          },
          'text/event-stream': {
            schema: {
              type: 'string',
              format: 'binary',
              description: 'Server-sent events stream for streaming responses',
            },
          },
        },
      },
      422: {
        description: 'Validation Error',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ValidationError',
            },
          },
        },
      },
    },
  },
}

// Add models endpoint
localSpec.paths['/v1/models'] = {
  get: {
    tags: ['Models'],
    summary: 'List available models',
    description:
      'Lists the currently available models and provides basic information about each one such as the owner and availability.',
    operationId: 'list_models',
    responses: {
      200: {
        description: 'Successful Response',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ModelList',
            },
            example: {
              object: 'list',
              data: LOCAL_MODELS.map((id) => ({
                id: id,
                object: 'model',
                created: 1686935002,
                owned_by: 'jan',
              })),
            },
          },
        },
      },
    },
  },
}

// Add tokenization endpoints
localSpec.paths['/extras/tokenize'] = {
  post: {
    tags: ['Extras'],
    summary: 'Tokenize text',
    description: "Convert text input into tokens using the model's tokenizer.",
    operationId: 'tokenize',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/TokenizeRequest',
          },
          example: {
            input: 'Hello, world!',
            model: LOCAL_MODELS[0],
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successful Response',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/TokenizeResponse',
            },
            example: {
              tokens: [15339, 11, 1917, 0],
            },
          },
        },
      },
    },
  },
}

localSpec.paths['/extras/tokenize/count'] = {
  post: {
    tags: ['Extras'],
    summary: 'Count tokens',
    description: 'Count the number of tokens in the provided text.',
    operationId: 'count_tokens',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            $ref: '#/components/schemas/TokenizeRequest',
          },
          example: {
            input: 'How many tokens does this text have?',
            model: LOCAL_MODELS[0],
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Successful Response',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/TokenCountResponse',
            },
            example: {
              count: 8,
            },
          },
        },
      },
    },
  },
}

// Copy ALL necessary schemas from cloud spec
const schemasToInclude = [
  // Request/Response schemas
  'CreateChatCompletionRequest',
  'CreateChatCompletionResponse',
  'CreateCompletionRequest',
  'CreateCompletionResponse',
  'ChatCompletionRequestMessage',
  'ChatCompletionRequestSystemMessage',
  'ChatCompletionRequestUserMessage',
  'ChatCompletionRequestAssistantMessage',
  'ChatCompletionResponseMessage',
  'ChatCompletionResponseChoice',
  'CompletionChoice',
  'CompletionUsage',
  'ModelList',
  'ModelData',
  'ValidationError',

  // Additional message types
  'ChatCompletionRequestFunctionMessage',
  'ChatCompletionRequestToolMessage',
  'ChatCompletionRequestMessageContentPart',
  'ChatCompletionRequestMessageContentPartText',
  'ChatCompletionRequestMessageContentPartImage',

  // Function calling
  'ChatCompletionFunction',
  'ChatCompletionFunctionCall',
  'ChatCompletionTool',
  'ChatCompletionToolCall',
  'ChatCompletionNamedToolChoice',

  // Response format
  'ChatCompletionRequestResponseFormat',

  // Logprobs
  'ChatCompletionLogprobs',
  'ChatCompletionLogprobToken',
  'ChatCompletionTopLogprobToken',
]

// Copy schemas from cloud spec (handle both definitions and schemas)
if (cloudSpec.definitions || cloudSpec.components?.schemas) {
  const sourceSchemas =
    cloudSpec.definitions || cloudSpec.components?.schemas || {}

  schemasToInclude.forEach((schemaName) => {
    if (sourceSchemas[schemaName]) {
      localSpec.components.schemas[schemaName] = JSON.parse(
        JSON.stringify(sourceSchemas[schemaName])
      )
    }
  })

  // Also copy any schemas that are referenced by the included schemas
  const processedSchemas = new Set(schemasToInclude)
  const schemasToProcess = [...schemasToInclude]

  while (schemasToProcess.length > 0) {
    const currentSchema = schemasToProcess.pop()
    const schema = localSpec.components.schemas[currentSchema]
    if (!schema) continue

    // Find all $ref references
    const schemaString = JSON.stringify(schema)
    const refPattern = /#\/(?:definitions|components\/schemas)\/([^"]+)/g
    let match

    while ((match = refPattern.exec(schemaString)) !== null) {
      const referencedSchema = match[1]
      if (
        !processedSchemas.has(referencedSchema) &&
        sourceSchemas[referencedSchema]
      ) {
        localSpec.components.schemas[referencedSchema] = JSON.parse(
          JSON.stringify(sourceSchemas[referencedSchema])
        )
        processedSchemas.add(referencedSchema)
        schemasToProcess.push(referencedSchema)
      }
    }
  }
}

// Add tokenization schemas manually
localSpec.components.schemas.TokenizeRequest = {
  type: 'object',
  properties: {
    input: {
      type: 'string',
      description: 'The text to tokenize',
    },
    model: {
      type: 'string',
      description: 'The model to use for tokenization',
      enum: LOCAL_MODELS,
    },
  },
  required: ['input'],
}

localSpec.components.schemas.TokenizeResponse = {
  type: 'object',
  properties: {
    tokens: {
      type: 'array',
      items: {
        type: 'integer',
      },
      description: 'Array of token IDs',
    },
  },
  required: ['tokens'],
}

localSpec.components.schemas.TokenCountResponse = {
  type: 'object',
  properties: {
    count: {
      type: 'integer',
      description: 'Number of tokens',
    },
  },
  required: ['count'],
}

// Update model references in schemas to use local models
if (
  localSpec.components.schemas.CreateChatCompletionRequest?.properties?.model
) {
  localSpec.components.schemas.CreateChatCompletionRequest.properties.model = {
    ...localSpec.components.schemas.CreateChatCompletionRequest.properties
      .model,
    enum: LOCAL_MODELS,
    example: LOCAL_MODELS[0],
    description: `ID of the model to use. Available models: ${LOCAL_MODELS.join(', ')}`,
  }
}

if (localSpec.components.schemas.CreateCompletionRequest?.properties?.model) {
  localSpec.components.schemas.CreateCompletionRequest.properties.model = {
    ...localSpec.components.schemas.CreateCompletionRequest.properties.model,
    enum: LOCAL_MODELS,
    example: LOCAL_MODELS[0],
    description: `ID of the model to use. Available models: ${LOCAL_MODELS.join(', ')}`,
  }
}

// Fix all $ref references to use components/schemas instead of definitions
function fixReferences(obj) {
  if (typeof obj === 'string') {
    return obj.replace(/#\/definitions\//g, '#/components/schemas/')
  }
  if (Array.isArray(obj)) {
    return obj.map(fixReferences)
  }
  if (obj && typeof obj === 'object') {
    const fixed = {}
    for (const key in obj) {
      fixed[key] = fixReferences(obj[key])
    }
    return fixed
  }
  return obj
}

// Apply reference fixes
localSpec.paths = fixReferences(localSpec.paths)
localSpec.components.schemas = fixReferences(localSpec.components.schemas)

// Add x-jan-local-features
localSpec['x-jan-local-features'] = {
  engine: 'llama.cpp',
  features: [
    'GGUF model support',
    'CPU and GPU acceleration',
    'Quantized model support (Q4, Q5, Q8)',
    'Metal acceleration on macOS',
    'CUDA support on NVIDIA GPUs',
    'ROCm support on AMD GPUs',
    'AVX/AVX2/AVX512 optimizations',
    'Memory-mapped model loading',
  ],
  privacy: {
    local_processing: true,
    no_telemetry: true,
    offline_capable: true,
  },
  model_formats: ['GGUF', 'GGML'],
  default_settings: {
    context_length: 4096,
    batch_size: 512,
    threads: 'auto',
  },
}

// Write the fixed spec
fs.writeFileSync(outputPath, JSON.stringify(localSpec, null, 2), 'utf8')

console.log('✅ Local OpenAPI spec fixed successfully!')
console.log(`📁 Output: ${outputPath}`)
console.log(`📊 Endpoints: ${Object.keys(localSpec.paths).length}`)
console.log(`📊 Schemas: ${Object.keys(localSpec.components.schemas).length}`)
console.log(
  `🎯 Examples: ${Object.keys(localSpec.paths).reduce((count, path) => {
    return (
      count +
      Object.keys(localSpec.paths[path]).reduce((c, method) => {
        const examples =
          localSpec.paths[path][method]?.requestBody?.content?.[
            'application/json'
          ]?.examples
        return c + (examples ? Object.keys(examples).length : 0)
      }, 0)
    )
  }, 0)}`
)
