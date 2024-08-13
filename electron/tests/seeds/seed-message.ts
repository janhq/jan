import { join } from 'path'
import { legacyDataPath } from '../../utils/path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs-extra';
import os from 'os'
import { load } from 'js-yaml';

const sampleThreads = [
    {
        "id": "jan_1723493088",
        "object": "thread",
        "title": "New Thread",
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
      }
]

const sampleMessages = [
    {"id":"01J5437S21MX7S1NA1W3QZJ6B9","thread_id":"jan_1723493088","role":"user","status":"ready","created":1723493246017,"updated":1723493246017,"object":"thread.message","content":[{"type":"text","text":{"value":"hey","annotations":[]}}]}
]

export const seedMessages = async () => {
    const janConfigPath = os.homedir()
    const janConfigFile = join(janConfigPath, '.janrc')
    const config = load(readFileSync(janConfigFile, 'utf-8')) as any
    const dataFolderPath = config.dataFolderPath
    const dbFileName = 'cortex.db'
    const dbPath = join(dataFolderPath, dbFileName)
    rmSync(dbPath, { force: true })
    const janThreadFolderPath = join(legacyDataPath(), 'threads')
    for (const thread of sampleThreads) {
        const threadFolder = join(janThreadFolderPath, thread.id)
        mkdirSync(threadFolder)
        const threadFile = join(threadFolder, 'thread.json')
        writeFileSync(threadFile, JSON.stringify(thread, null, 2))
        const messages = sampleMessages.filter(m => m.thread_id === thread.id)
        const messageFile = join(threadFolder, 'messages.jsonl')
        writeFileSync(messageFile, messages.map(m => JSON.stringify(m)).join('\n'))
    }
}