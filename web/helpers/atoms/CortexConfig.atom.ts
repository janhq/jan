export type CortexConfig = {
  dataFolderPath: string
  initialized: boolean
  cortexCppHost: string
  cortexCppPort: number
  mistral: {
    apiKey: string
  }
  openai: {
    apiKey: string
  }
  groq: {
    apiKey: string
  }
}
