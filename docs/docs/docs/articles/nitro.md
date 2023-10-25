---
sidebar_position: 1
title: Why Nitro? The Inference Engine Behind Jan
---

Delve into Nitro, a robust inference engine that powers Jan. Nitro is a dedicated "inference server" crafted in C++, optimized for edge deployment, ensuring reliability and performance.

⚡ Explore Nitro's codebase: [GitHub](https://github.com/janhq/nitro)

## Problems of AI services

Everyone wants to build their AI app, but they have a few challenges below.

1. **No privacy**

If you use an AI API like OpenAI ChatGPT, just say goodbye to privacy already.

2. **Cumbersome integration**

Let say you already have some interesting libraries for local AI, it's still very cumbersome to integrate.

If you want to use something cutting edge like [llama-cpp](https://github.com/ggerganov/llama.cpp) you need to know a bit of CPP.

And many other reaons.

3. **Not standardized interface**

Let say you solved the above points, you will still have issues with non-standard interface, you cannot re-use other projects code.


## Benefits of Using Nitro:

1. **Compact Binary Size**:  
   - Nitro's efficient binary size: ~3mb compressed on average
     ![](https://hackmd.io/_uploads/Sy_IYU8GT.png)

2. **Streamlined Deployment**:  
   Nitro is designed for ease of deployment. Simply download and execute. Note the requirement for specific hardware dependencies, like CUDA.

3. **User-Friendly Interface**:  
   Nitro offers a straightforward HTTP interface. With compatibility for multiple standard APIs, including OpenAI formats, integration is hassle-free.

   ```bash
   curl --location 'http://localhost:3928/inferences/llamacpp/chat_completion' \
        --header 'Content-Type: application/json' \
        --header 'Accept: text/event-stream' \
        --header 'Access-Control-Allow-Origin: *' \
        --data '{
           "messages": [
               {"content": "Hello there 👋", "role": "assistant"},
               {"content": "Can you write a long story", "role": "user"}
           ],
           "stream": true,
           "model": "gpt-3.5-turbo",
           "max_tokens": 2000
        }'
   ```

4. **Seperated process**:  
   Nitro operates independently, ensuring no interference with your main application processes. It self-manages, allowing you a focused development environment.

5. **Broad Compatibility**:  
   Nitro supports a variety of platforms including Windows, MacOS, and Linux, and is compatible with arm64, x86, and NVIDIA GPUs, ensuring a versatile deployment experience.
   
6. **Multi-threaded and performant by default***
    Built on DrogonCPP, a very fast CPP web framework in CPP. 

## Getting Started with Nitro:

**Step 1: Obtain Nitro**:  
Access Nitro binaries from the release page to begin.  
🔗 [Download Nitro](https://github.com/janhq/nitro/releases)

**Step 2: Source a Model**:  
For those interested in the llama C++ integration, obtain a "GGUF" model from The Bloke's repository.  
🔗 [Download Model](https://huggingface.co/TheBloke)

**Step 3: Initialize Nitro**:  
Launch Nitro and position your model using the following API call:

```bash
curl -X POST 'http://localhost:3928/inferences/llamacpp/loadmodel' \
  -H 'Content-Type: application/json' \
  -d '{
    "llama_model_path": "/path/to/your_model.gguf",
    "ctx_len": 2048,
    "ngl": 100,
    "embedding": true
  }'
```

**Step 4: Engage with Nitro**:  
Interact with Nitro to evaluate its capabilities. With its alignment to the OpenAI format, you can anticipate consistent and reliable output.
