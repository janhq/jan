---
title: Recommended AI Hardware by Use Case
---

## Personal Use

### Entry-level Experimentation

### Personal Use

- Macbook (16gb)
- 3090

### Prosumer Use

- Apple Silicon
- 2 x 3090 (48gb RAM)

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