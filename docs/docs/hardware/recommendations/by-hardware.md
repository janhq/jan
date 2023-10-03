---
title: Recommended AI Hardware
---

## Overview

Large language models(LLMs) have changed how computers handle human-like text and language tasks. However using them through APIs or cloud services can be costly and limiting. What if you could use these powerful models directly on your personal computer, without extra expenses? Running them on your own machine provides flexibility, control, and cost savings. In this guide, I'll show you how to do just that, unlocking their potential without relying on expensive APIs or cloud services.

To run Large language models(LLMs) model at home machine, you will need a computer built with a GPU that can handle the large amount of data and computation required for inferencing.

The GPU stands as the pivotal component for running LLMs, bearing the primary responsibility for processing tasks associated with model execution. The performance of the GPU directly dictates the speed of inference.

While certain model variations and implementations may demand less potent hardware, the GPU retains its central role as the cornerstone of the system. The advantage of the GPU is that it can significantly improve performance compared to the CPU.

## GPU Selection

Selecting the optimal GPU for running Large Language Models (LLMs) on your home PC is a decision influenced by your budget and the specific LLMs you intend to work with. Your choice should strike a balance between performance, efficiency, and cost-effectiveness.

In general, the following GPU features are important for running LLMs:

- **High VRAM:** LLMs are typically very large and complex models, so they require a GPU with a high amount of VRAM. This will allow the model to be loaded into memory and processed efficiently.
- **CUDA Compatibility:** When running LLMs on a GPU, CUDA compatibility is paramount. CUDA is NVIDIA's parallel computing platform, and it plays a vital role in accelerating deep learning tasks. LLMs, with their extensive matrix calculations, heavily rely on parallel processing. Ensuring your GPU supports CUDA is like having the right tool for the job. It allows the LLM to leverage the GPU's parallel processing capabilities, significantly speeding up model training and inference.
- **Number of CUDA, Tensor, and RT Cores:** High-performance NVIDIA GPUs have both CUDA and Tensor cores. These cores are responsible for executing the neural network computations that underpin LLMs' language understanding and generation. The more CUDA cores your GPU has, the better equipped it is to handle the massive computational load that LLMs impose. Tensor cores in your GPU, further enhance LLM performance by accelerating the critical matrix operations integral to language modeling tasks.
- **Generation (Series)**: When selecting a GPU for LLMs, consider its generation or series (e.g., RTX 30 series). Newer GPU generations often come with improved architectures and features. For LLM tasks, opting for the latest generation can mean better performance, energy efficiency, and support for emerging AI technologies. Avoid purchasing, RTX-2000 series GPUs which are much outdated nowadays.

### Here are some of the best GPU options for this purpose:

1. **NVIDIA RTX 3090**: The NVIDIA RTX 3090 is a high-end GPU with a substantial 24GB of VRAM. This copious VRAM capacity makes it exceptionally well-suited for handling large LLMs. Moreover, it's known for its relative efficiency, meaning it won't overheat or strain your home PC's cooling system excessively. The RTX 3090's robust capabilities are a boon for those who need to work with hefty language models.
2. **NVIDIA RTX 4090**: If you're looking for peak performance and can afford the investment, the NVIDIA RTX 4090 represents the pinnacle of GPU power. Boasting 24GB of VRAM and featuring a cutting-edge Tensor Core architecture tailored for AI workloads, it outshines the RTX 3090 in terms of sheer capability. However, it's important to note that the RTX 4090 is also pricier and more power-hungry than its predecessor, the RTX 3090.
3. **AMD Radeon RX 6900 XT**: On the AMD side, the Radeon RX 6900 XT stands out as a high-end GPU with 16GB of VRAM. While it may not quite match the raw power of the RTX 3090 or RTX 4090, it strikes a balance between performance and affordability. Additionally, it tends to be more power-efficient, which could translate to a more sustainable and quieter setup in your home PC.

If budget constraints are a consideration, there are more cost-effective GPU options available:

- **NVIDIA RTX 3070**: The RTX 3070 is a solid mid-range GPU that can handle LLMs effectively. While it may not excel with the most massive or complex language models, it's a reliable choice for users looking for a balance between price and performance.
- **AMD Radeon RX 6800 XT**: Similarly, the RX 6800 XT from AMD offers commendable performance without breaking the bank. It's well-suited for running mid-sized LLMs and provides a competitive option in terms of both power and cost.

When selecting a GPU for LLMs, remember that it's not just about the GPU itself. Consider the synergy with other components in your PC:

- **CPU**: To ensure efficient processing, pair your GPU with a powerful CPU. LLMs benefit from fast processors, so having a capable CPU is essential.
- **RAM**: Sufficient RAM is crucial for LLMs. They can be memory-intensive, and having enough RAM ensures smooth operation.
- **Cooling System**: LLMs can push your PC's hardware to the limit. A robust cooling system helps maintain optimal temperatures, preventing overheating and performance throttling.

By taking all of these factors into account, you can build a home PC setup that's well-equipped to handle the demands of running LLMs effectively and efficiently.

## CPU Selection

Selecting the right CPU for running Large Language Models (LLMs) on your home PC is contingent on your budget and the specific LLMs you intend to work with. It's a decision that warrants careful consideration, as the CPU plays a pivotal role in determining the overall performance of your system.

In general, the following CPU features are important for running LLMs:

- **Number of Cores and Threads:** the number of CPU cores and threads influences parallel processing. More cores and threads help handle the complex computations involved in language models. For tasks like training and inference, a higher core/thread count can significantly improve processing speed and efficiency, enabling quicker results.
- **High clock speed:** The base clock speed, or base frequency, represents the CPU's default operating speed. So having a CPU with a high clock speed. This will allow the model to process instructions more quickly, which can further improve performance.
- **Base Power (TDP):** LLMs often involve long training sessions and demanding computations. Therefore, a lower Thermal Design Power (TDP) is desirable. A CPU with a lower TDP consumes less power and generates less heat during prolonged LLM operations. This not only contributes to energy efficiency but also helps maintain stable temperatures in your system, preventing overheating and potential performance throttling.
- **Generation (Series):** Consider its generation or series (e.g., 9th Gen, 11th Gen Intel Core). Newer CPU generations often come with architectural improvements that enhance performance and efficiency. For LLM tasks, opting for a more recent generation can lead to faster and more efficient language model training and inference.
- **Support for AVX512:** AVX512 is a set of vector instruction extensions that can be used to accelerate machine learning workloads. Many LLMs are optimized to take advantage of AVX512, so it is important to make sure that your CPU supports this instruction set.

### Here are some CPU options for running LLMs:

1. **Intel Core i7-12700K**: Slightly less potent than the Core i9-12900K, the Intel Core i7-12700K is still a powerful CPU. With 12 cores and 20 threads, it strikes a balance between performance and cost-effectiveness. This CPU is well-suited for running mid-sized and large LLMs, making it a compelling option.
2. **Intel Core i9-12900K**: Positioned as a high-end CPU, the Intel Core i9-12900K packs a formidable punch with its 16 cores and 24 threads. It's one of the fastest CPUs available, making it an excellent choice for handling large and intricate LLMs. The abundance of cores and threads translates to exceptional parallel processing capabilities, which is crucial for tasks involving massive language models.
3. **AMD Ryzen 9 5950X**: Representing AMD's high-end CPU offering, the Ryzen 9 5950X boasts 16 cores and 32 threads. While it may not quite match the speed of the Core i9-12900K, it remains a robust and cost-effective choice. Its multicore prowess enables smooth handling of LLM workloads, and its affordability makes it an attractive alternative.
4. **AMD Ryzen 7 5800X**: Slightly less potent than the Ryzen 9 5950X, the Ryzen 7 5800X is still a formidable CPU with 8 cores and 16 threads. It's well-suited for running mid-sized and smaller LLMs, providing a compelling blend of performance and value.

For those operating within budget constraints, there are more budget-friendly CPU options:

- **Intel Core i5-12600K**: The Core i5-12600K is a capable mid-range CPU that can still handle LLMs effectively, though it may not be optimized for the largest or most complex models.
- **AMD Ryzen 5 5600X**: The Ryzen 5 5600X offers a balance of performance and affordability. It's suitable for running smaller to mid-sized LLMs without breaking the bank.

**When selecting a CPU for LLMs, consider the synergy with other components in your PC:**

- **GPU**: Pair your CPU with a powerful GPU to ensure smooth processing of LLMs. Some language models, particularly those used for AI, rely on GPU acceleration for optimal performance.
- **RAM**: Adequate RAM is essential for LLMs, as these models can be memory-intensive. Having enough RAM ensures that your CPU can operate efficiently without bottlenecks.
- **Cooling System**: Given the resource-intensive nature of LLMs, a robust cooling system is crucial to maintain optimal temperatures and prevent performance throttling.

By carefully weighing your budget and performance requirements and considering the interplay of components in your PC, you can assemble a well-rounded system that's up to the task of running LLMs efficiently.

> :memo: **Note:** It is important to note that these are just general recommendations. The specific CPU requirements for your LLM will vary depending on the specific model you are using and the tasks that you want to perform with it. If you are unsure what CPU to get, it is best to consult with an expert.

## RAM Selection

The amount of RAM you need to run an LLM depends on the size and complexity of the model, as well as the tasks you want to perform with it. For example, if you are simply running inference on a pre-trained LLM, you may be able to get away with using a relatively modest amount of RAM. However, if you are training a new LLM from scratch, or if you are running complex tasks like fine-tuning or code generation, you will need more RAM.

### Here is a general guide to RAM selection for running LLMs:

- **Capacity:** The amount of RAM you need will depend on the size and complexity of the LLM model you want to run. For inference, you will need at least 16GB of RAM, but 32GB or more is ideal for larger models and more complex tasks. For training, you will need at least 64GB of RAM, but 128GB or more is ideal for larger models and more complex tasks.
- **Speed:** LLMs can benefit from having fast RAM, so it is recommended to use DDR4 or DDR5 RAM with a speed of at least 3200MHz.
- **Latency:** RAM latency is the amount of time it takes for the CPU to access data in memory. Lower latency is better for performance, so it is recommended to look for RAM with a low latency rating.
- **Timing:** RAM timing is a set of parameters that control how the RAM operates. It is important to make sure that the RAM timing is compatible with your motherboard and CPU.

R**ecommended RAM** **options for running LLMs:**

- **Inference:** For inference on pre-trained LLMs, you will need at least 16GB of RAM. However, 32GB or more is ideal for larger models and more complex tasks.
- **Training:** For training LLMs from scratch, you will need at least 64GB of RAM. However, 128GB or more is ideal for larger models and more complex tasks.

In addition to the amount of RAM, it is also important to consider the speed of the RAM. LLMs can benefit from having fast RAM, so it is recommended to use DDR4 or DDR5 RAM with a speed of at least 3200MHz.

## Motherboard Selection

When picking a motherboard to run advanced language models, you need to think about a few things. First, consider the specific language model you want to use, the type of CPU and GPU in your computer, and your budget. Here are some suggestions:

1. **ASUS ROG Maximus Z790 Hero:** This is a top-notch motherboard with lots of great features. It works well with Intel's latest CPUs, fast DDR5 memory, and PCIe 5.0 devices. It's also good at keeping things cool, which is important for running demanding language models.
2. **MSI MEG Z790 Ace:** Similar to the ASUS ROG Maximus, this motherboard is high-end and has similar features. It's good for running language models too.
3. **Gigabyte Z790 Aorus Master:** This one is more budget-friendly but still works great with Intel's latest CPUs, DDR5 memory, and fast PCIe 5.0 devices. It's got a strong power system, which helps with running language models.

If you're on a tighter budget, you might want to check out mid-range options like the **ASUS TUF Gaming Z790-Plus WiFi** or the **MSI MPG Z790 Edge WiFi DDR5**. They offer good performance without breaking the bank.

No matter which motherboard you pick, make sure it works with your CPU and GPU. Also, check that it has the features you need, like enough slots for your GPU and storage drives.

Other things to think about when choosing a motherboard for language models:

- **Cooling:** Language models can make your CPU work hard, so a motherboard with good cooling is a must. This keeps your CPU from getting too hot.
- **Memory:** Language models need lots of memory, so make sure your motherboard supports a good amount of it. Check if it works with the type of memory you want to use, like DDR5 or DDR4.
- **Storage:** Language models can create and store a ton of data. So, look for a motherboard with enough slots for your storage drives.
- **BIOS:** The BIOS controls your motherboard. Make sure it's up-to-date and has the latest features, especially if you plan to overclock or undervolt your system.

## Cooling System Selection

Modern computers have two critical components, the CPU and GPU, which can heat up during high-performance tasks. To prevent overheating, they come with built-in temperature controls that automatically reduce performance when temperatures rise. To keep them cool and maintain optimal performance, you need a reliable cooling system.

For laptops, the only choice is a fan-based cooling system. Laptops have built-in fans and copper pipes to dissipate heat. Many gaming laptops even have two separate fans: one for the CPU and another for the GPU.

For desktop computers, you have the option to install more efficient water cooling systems. These are highly effective but can be expensive. Or you can install more cooling fans to keep you components cool.

Keep in mind that dust can accumulate in fan-based cooling systems, leading to malfunctions. So periodically clean the dust to keep your cooling system running smoothly.

## Use MacBook to run LLMs

An Apple MacBook equipped with either the M1 or the newer M2 Pro/Max processor. These cutting-edge chips leverage Apple's innovative Unified Memory Architecture (UMA), which revolutionizes the way the CPU and GPU interact with memory resources. This advancement plays a pivotal role in enhancing the performance and capabilities of LLMs.

Unified Memory Architecture, as implemented in Apple's M1 and M2 series processors, facilitates seamless and efficient data access for both the CPU and GPU. Unlike traditional systems where data needs to be shuttled between various memory pools, UMA offers a unified and expansive memory pool that can be accessed by both processing units without unnecessary data transfers. This transformative approach significantly minimizes latency while concurrently boosting data access bandwidth, resulting in substantial improvements in both the speed and quality of outputs.
![UMA](https://media.discordapp.net/attachments/1148534242104574012/1156600109967089714/IMG_3722.webp?ex=6516380a&is=6514e68a&hm=ebe3b6ecb1edb44cde58bd8d3fdd46cef66b60aa41ea6c03b51325fa65f8517e&=&width=807&height=426)

The M1 and M2 Pro/Max chips offer varying levels of unified memory bandwidth, further underscoring their prowess in handling data-intensive tasks like AI processing. The M1/M2 Pro chip boasts an impressive capacity of up to 200 GB/s of unified memory bandwidth, while the M1/M2 Max takes it a step further, supporting up to a staggering 400 GB/s of unified memory bandwidth. This means that regardless of the complexity and demands of the AI tasks at hand, these Apple laptops armed with M1 or M2 processors are well-equipped to handle them with unparalleled efficiency and speed.

## Optimizing Memory Speed for AI Models

When it comes to utilizing LLMs effectively, you must delve into the intricacies of memory speed, as it plays a critical role in determining inference speed. These large language models necessitate full loading into RAM or VRAM each time they generate a new token, which is essentially a piece of text. For instance, a 4-bit 13-billion-parameter CodeLlama model consumes roughly 7.5GB of RAM.

To understand the impact of memory bandwidth, let's consider an example. If your system boasts a RAM bandwidth of 50 Gbps (achieved with components like DDR4-3200 in tandem with a Ryzen 5 5600X), you can generate approximately 6 tokens per second. However, if you aspire to attain faster speeds, such as 11 tokens per second, you'll need a higher memory bandwidth, like DDR5-5600 with around 90 Gbps.

For a broader context, consider top-tier GPUs like the Nvidia RTX 3090, which offers an impressive 930 Gbps of VRAM bandwidth. In contrast, the latest DDR5 RAM can provide up to 100GB/s of memory bandwidth. Recognizing and optimizing for memory bandwidth is paramount to efficiently running models like CodeLlama, as it directly influences the speed at which you can generate text tokens during inference.

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

<!--
## Macbook 8GB RAM

## Macbook 16GB RAM -->
