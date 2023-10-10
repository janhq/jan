---
title: Recommended AI Hardware by Model
---

## Codellama 34b

### System Requirements:

**For example**: If you want to use [Codellama 7B](https://huggingface.co/TheBloke/CodeLlama-7B-Instruct-GPTQ/tree/main) models on your own computer, you can take advantage of your GPU and run this with GPTQ file models.

GPTQ is a format that compresses the model parameters to 4-bit, which reduces the VRAM requirements significantly. You can use the [oobabooga webui](https://github.com/oobabooga/text-generation-webui) or [JanAI](https://jan.ai/), which are simple interfaces that let you interact with different LLMS on your browser. It is pretty easy to set up and run. You can install it on Windows or Linux. (linked it to our installation page)

**For 7B Parameter Models (4-bit Quantization)**

| Format                                           | RAM Requirements     | VRAM Requirements | Minimum recommended GPU                   |
| ------------------------------------------------ | -------------------- | ----------------- | ----------------------------------------- |
| GPTQ (GPU inference)                             | 6GB (Swap to Load\*) | 6GB               | GTX 1660, 2060,RTX 3050, 3060 AMD 5700 XT |
| GGML / GGUF (CPU inference)                      | 4GB                  | 300MB             |                                           |
| Combination of GPTQ and GGML / GGUF (offloading) | 2GB                  | 2GB               |                                           |

**For 13B Parameter Models (4-bit Quantization)**

| Format                                           | RAM Requirements      | VRAM Requirements | Minimum recommended GPU                            |
| ------------------------------------------------ | --------------------- | ----------------- | -------------------------------------------------- |
| GPTQ (GPU inference)                             | 12GB (Swap to Load\*) | 10GB              |                                                    |
| GGML / GGUF (CPU inference)                      | 8GB                   | 500MB             | AMD 6900 XT, RTX 2060 12GB, 3060 12GB, 3080, A2000 |
| Combination of GPTQ and GGML / GGUF (offloading) | 10GB                  | 10GB              |                                                    |

**For 34B Parameter Models (4-bit Quantization)**

| Format                                           | RAM Requirements      | VRAM Requirements | Minimum recommended GPU                                              |
| ------------------------------------------------ | --------------------- | ----------------- | -------------------------------------------------------------------- |
| GPTQ (GPU inference)                             | 32GB (Swap to Load\*) | 20GB              |                                                                      |
| GGML / GGUF (CPU inference)                      | 20GB                  | 500MB             | RTX 3080 20GB, A4500, A5000, 3090, 4090, 6000, Tesla V100, Tesla P40 |
| Combination of GPTQ and GGML / GGUF (offloading) | 10GB                  | 4GB               |                                                                      |

**For 7B Parameter Models (8-bit Quantization)**

| Format                                           | RAM Requirements      | VRAM Requirements | Minimum recommended GPU                |
| ------------------------------------------------ | --------------------- | ----------------- | -------------------------------------- |
| GPTQ (GPU inference)                             | 24GB (Swap to Load\*) | 12GB              | RTX 3080, RTX 3080 Ti, RTX 3090, A5000 |
| GGML / GGUF (CPU inference)                      | 16GB                  | 1GB               | RTX 3060 12GB, RTX 3070, A2000         |
| Combination of GPTQ and GGML / GGUF (offloading) | 12GB                  | 4GB               | RTX 3060, RTX 3060 Ti, A2000           |

**For 13B Parameter Models (8-bit Quantization)**

| Format                                           | RAM Requirements      | VRAM Requirements | Minimum recommended GPU           |
| ------------------------------------------------ | --------------------- | ----------------- | --------------------------------- |
| GPTQ (GPU inference)                             | 36GB (Swap to Load\*) | 20GB              | RTX 4090, A6000, A6000 Ti, A8000  |
| GGML / GGUF (CPU inference)                      | 24GB                  | 2GB               | RTX 3080 20GB, RTX 3080 Ti, A5000 |
| Combination of GPTQ and GGML / GGUF (offloading) | 20GB                  | 8GB               | RTX 3080, RTX 3080 Ti, A5000      |

**For 34B Parameter Models (8-bit Quantization)**

| Format                                           | RAM Requirements      | VRAM Requirements | Minimum recommended GPU          |
| ------------------------------------------------ | --------------------- | ----------------- | -------------------------------- |
| GPTQ (GPU inference)                             | 64GB (Swap to Load\*) | 40GB              | A8000, A8000 Ti, A9000           |
| GGML / GGUF (CPU inference)                      | 40GB                  | 2GB               | RTX 4090, A6000, A6000 Ti, A8000 |
| Combination of GPTQ and GGML / GGUF (offloading) | 48GB                  | 20GB              | RTX 4090, A6000, A6000 Ti, A8000 |

> :memo: **Note**: System RAM, not VRAM, required to load the model, in addition to having enough VRAM. Not required to run the model. You can use swap space if you do not have enough RAM.

### Performance Recommendations:

1. **Optimal Performance**: To achieve the best performance when working with CodeLlama models, consider investing in a high-end GPU such as NVIDIA's latest RTX 3090 or RTX 4090. For the largest models like the 65B and 70B, a dual GPU setup is recommended. Additionally, ensure your system boasts sufficient RAM, with a minimum of 16 GB, although 64 GB is ideal for seamless operation.
2. **Budget-Friendly Approach**: If budget constraints are a concern, focus on utilizing CodeLlama GGML/GGUF models that can comfortably fit within your system's available RAM. Keep in mind that while you can allocate some model weights to the system RAM to save GPU memory, this may result in a performance trade-off.

> :memo: **Note**: It's essential to note that these recommendations are guidelines, and the actual performance you experience will be influenced by various factors. These factors include the specific task you're performing, the implementation of the model, and the concurrent system processes. To optimize your setup, consider these recommendations as a starting point and adapt them to your unique requirements and constraints.
