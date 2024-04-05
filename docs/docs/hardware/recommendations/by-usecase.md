---
title: Recommended AI Hardware by Use Case
---

## Which AI Hardware to Choose Based on Your Use Case

Artificial intelligence (AI) is rapidly changing the world, and AI hardware is becoming increasingly important for businesses and individuals alike. Choosing the right hardware for your AI needs is crucial to get the best performance and results. Here are some tips for selecting AI hardware based on your specific use case and requirements.

### Entry-level Experimentation:

**Personal Use:**
When venturing into the world of AI as an individual, your choice of hardware can significantly impact your experience. Here's a more detailed breakdown:

- **Macbook (16GB):** A Macbook equipped with 16GB of RAM and either the M1 or the newer M2 Pro/Max processor is an excellent starting point for AI enthusiasts. These cutting-edge chips leverage Apple's innovative Unified Memory Architecture (UMA), which revolutionizes the way the CPU and GPU interact with memory resources. This advancement plays a pivotal role in enhancing the performance and capabilities of LLMs.
- **Nvidia GeForce RTX 3090:** This powerful graphics card is a solid alternative for AI beginners, offering exceptional performance for basic experiments.

2.  **Serious AI Work:**

- **2 x 3090 RTX Card (48GB RAM):** For those committed to more advanced AI projects, this configuration provides the necessary muscle. Its dual Nvidia GeForce RTX 3090 GPUs and ample RAM make it suitable for complex AI tasks and model training.

## Business Use

### For a 10-person Small Business

Run a LLM trained on enterprise data (i.e. RAG)

- Mac Studio M2 Ultra with 192GB unified memory
  - Cannot train
- RTX 6000
  - Should we recommend 2 x 4090 instead?

### For a 50-person Law Firm

- LLM, PDF Parsing, OCR
- Audit logging and compliance

### For a 1,000-student School

- Llama2 with safeguards
- RAG with textbook data
- Policy engine

## Software Engineering

### Personal Code Assistant

- Llama34b, needs adequate RAM
- Not recommended to run on local device due to RAM

### For a 10 person Software Team

Run Codellama with RAG on existing codebase

- Codellama34b
- RTX 6000s (48gb)

## Enterprise

### For a 1000-person Enterprise

### For a 10,000-person Enterprise

- 8 x H100s
- NVAIE with vGPUs
