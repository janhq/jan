const gguf = require('gguf/dist/index')

const test = async () => {
  // pass in a file path, gguf.js will only load in what is needed for the metadata
  // not the whole file
  const { metadata, error } = await gguf(
    '/Users/hiro/Downloads/tinyllama-1.1b-chat-v0.3.Q2_K.gguf'
  )

  if (error) {
    throw error
  }

  console.log(metadata)
}

test()
