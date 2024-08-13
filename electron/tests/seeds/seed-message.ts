import { v4 as uuid } from 'uuid'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs-extra';

const sampleThreads = [
    {
        "id": `jan_${Date.now()}`,
        "object": "thread",
        "title": `thread_${Date.now()}`,
        "assistants": [
          {
            "assistant_id": "jan",
            "assistant_name": "Jan",
            "tools": [
              {
                "type": "retrieval",
                "enabled": false,
                "useTimeWeightedRetriever": false,
                "settings": {
                  "top_k": 2,
                  "chunk_size": 1024,
                  "chunk_overlap": 64,
                  "retrieval_template": "Use the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer.\n----------------\nCONTEXT: {CONTEXT}\n----------------\nQUESTION: {QUESTION}\n----------------\nHelpful Answer:"
                }
              }
            ],
            "model": {
              "id": "claude-3-opus-20240229",
              "settings": {},
              "parameters": {
                "max_tokens": 2048,
                "temperature": 0.7,
                "stream": false
              },
              "engine": "anthropic"
            },
            "instructions": ""
          }
        ],
        "created": 1723493088249,
        "updated": 1723493088249
      },
      {
        "id": `jan_${Date.now()}`,
        "object": "thread",
        "title": `thread_${Date.now()}`,
        "assistants": [
          {
            "assistant_id": "jan",
            "assistant_name": "Jan",
            "tools": [
              {
                "type": "retrieval",
                "enabled": false,
                "useTimeWeightedRetriever": false,
                "settings": {
                  "top_k": 2,
                  "chunk_size": 1024,
                  "chunk_overlap": 64,
                  "retrieval_template": "Use the following pieces of context to answer the question at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer.\n----------------\nCONTEXT: {CONTEXT}\n----------------\nQUESTION: {QUESTION}\n----------------\nHelpful Answer:"
                }
              }
            ],
            "model": {
              "id": "tinyllama",
              "settings": {},
              "parameters": {
                "max_tokens": 2048,
                "temperature": 0.7,
                "stream": false
              },
              "engine": "cortex.llamacpp",
            },
            "instructions": ""
          }
        ],
        "created": 1723493088249,
        "updated": 1723493088249
      },

]

const sampleMessages = [
    {"id":`${uuid()}`,"thread_id": sampleThreads[0].id,"role":"user","status":"ready","created":1723493246017,"updated":1723493246017,"object":"thread.message","content":[{"type":"text","text":{"value":"hey","annotations":[]}}]},
    {"id":`${uuid()}`,"thread_id": sampleThreads[0].id,"role":"user","status":"ready","created":172349324, "updated":1723493246017,"object":"thread.message","content":[{"type":"text","text":{"value":"how are you","annotations":[]}}]},
    {"id":`${uuid()}`,"thread_id": sampleThreads[0].id,"role":"user","status":"ready","created":172349324, "updated":1723493246017,"object":"thread.message","content":[{"type":"text","text":{"value":"what is the weather like","annotations":[]}}]},
]

export const seedData = async (path) => {
    const janThreadFolderPath = join(path, 'threads')
    for (const thread of sampleThreads) {
        const threadFolder = join(janThreadFolderPath, thread.id)
        mkdirSync(threadFolder, { recursive: true })
        const threadFile = join(threadFolder, 'thread.json')
        writeFileSync(threadFile, JSON.stringify(thread, null, 2))
        const messages = sampleMessages.filter(m => m.thread_id === thread.id)
        const messageFile = join(threadFolder, 'messages.jsonl')
        writeFileSync(messageFile, messages.map(m => JSON.stringify(m)).join('\n'))
    }
    return { threads: sampleThreads, messages: sampleMessages }
}