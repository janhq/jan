---
sidebar_position: 1
title: Introduction
---

## How to choose LLMs for your work

Choosing the right Large Language Model (LLM) doesn't have to be complicated. It's all about finding one that works well for your needs. Here's a simple guide to help you pick the perfect LLM:

1. **Set Up the Basics**: First, get everything ready on your computer. Make sure you have the right software and tools to run these models. Then, give them a try on your system.
2. **Watch Your Memory**: Pay attention to how much memory these models are using. Some are bigger than others, and you need to make sure your computer can handle them.
3. **Find Compatible Models**: Look for the models that are like the top players in the game. These models are known to work well with the tools you're using. Keep these models in your shortlist.
4. **Test Them Out**: Take the models on your shortlist and give them a try with your specific task. This is like comparing different cars by taking them for a test drive. It helps you see which one works best for what you need.
5. **Pick the Best Fit**: After testing, you'll have a better idea of which model is the winner for your project. Consider things like how well it performs, how fast it is, if it works with your computer, and the software you're using.
6. **Stay Updated**: Remember that this field is always changing and improving. Keep an eye out for updates and new models that might be even better for your needs.

And the good news is, finding the right LLM is easier now. We've got a handy tool called Extractum LLM Explorer that you can use online. It helps you discover, compare, and rank lots of different LLMs. Check it out at **[Extractum](http://llm.extractum.io/)**, and it'll make your selection process a breeze!

You can also use [Model Memory Calculator](https://huggingface.co/spaces/hf-accelerate/model-memory-usage) tool designed to assist in determining the required vRAM for training and conducting inference with large models hosted on the Hugging Face Hub. The tool identifies the minimum recommended vRAM based on the size of the 'largest layer' within the model. Additionally, it's worth noting that model training typically necessitates approximately four times the size of the model, especially when using the Adam optimization. Keep in mind When performing inference, expect to add up to an additional 20% to this as found by [EleutherAI](https://blog.eleuther.ai/transformer-math/). More tests will be performed in the future to get a more accurate benchmark for each model.

## How to Calculate How Much vRAM is Required to My Selected LLM

**For example:** Calculating the VRAM required to run a 13-billion-parameter Large Language Model (LLM) involves considering the model size, batch size, sequence length, token size, and any additional overhead. Here's how you can estimate the VRAM required for a 13B LLM:

1. **Model Size**: Find out the size of the 13B LLM in terms of the number of parameters. This information is typically provided in the model's documentation. A 13-billion-parameter model has 13,000,000,000 parameters.
2. **Batch Size**: Decide on the batch size you want to use during inference. The batch size represents how many input samples you process simultaneously. Smaller batch sizes require less VRAM.
3. **Sequence Length**: Determine the average length of the input text sequences you'll be working with. Sequence length can impact VRAM requirements; longer sequences need more memory.
4. **Token Size**: Understand the memory required to store one token in bytes. Most LLMs use 4 bytes per token.
5. **Overhead**: Consider any additional memory overhead for intermediate computations and framework requirements. Overhead can vary but should be estimated based on your specific setup.

Use the following formula to estimate the VRAM required:

**VRAM Required (in gigabytes)** = `Model Parameters x Token Size x Batch Size x Sequence Length + Overhead`

- **Model Parameters**: 13,000,000,000 parameters for a 13B LLM.
- **Token Size**: Usually 4 bytes per token.
- **Batch Size**: Choose your batch size.
- **Sequence Length**: The average length of input sequences.
- **Overhead**: Any additional VRAM required based on your setup.

Here's an example:

Suppose you want to run a 13B LLM with the following parameters:

- **Batch Size**: 4
- **Sequence Length**: 512 tokens
- **Token Size**: 4 bytes
- **Estimated Overhead**: 2 GB

VRAM Required (in gigabytes) = `(13,000,000,000 x 4 x 4 x 512) + 2`

VRAM Required (in gigabytes) = `(8,388,608,000) + 2,000`

VRAM Required (in gigabytes) ≈ `8,390,608,000 bytes`

To convert this to gigabytes, divide by `1,073,741,824 (1 GB)`

VRAM Required (in gigabytes) ≈ `8,390,608,000 / 1,073,741,824 ≈ 7.8 GB`

So, to run a 13-billion-parameter LLM with the specified parameters and overhead, you would need approximately 7.8 gigabytes of VRAM on your GPU. Make sure to have some additional VRAM for stable operation and consider testing the setup in practice to monitor VRAM usage accurately.
