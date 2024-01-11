---
title: Engineering
description: Jan is a ChatGPT-alternative that runs on your own computer, with a local API server.
keywords:
  [
    Jan AI,
    Jan,
    ChatGPT alternative,
    local AI,
    private AI,
    conversational AI,
    no-subscription fee,
    large language model,
  ]
---

## Connecting to Rigs

### Pritunl Setup

1. **Install Pritunl**: [Download here](https://client.pritunl.com/#install)
2. **Import .ovpn file**
3. **VSCode**: Install the "Remote-SSH" extension for connection

### Llama.cpp Setup

1. **Clone Repo**: `git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp`
2. **Build**:

```bash
mkdir build && cd build
cmake .. -DLLAMA_CUBLAS=ON -DLLAMA_CUDA_F16=ON -DLLAMA_CUDA_MMV_Y=8
cmake --build . --config Release
```

3. **Download Model:**

```bash
cd ../models && wget https://huggingface.co/TheBloke/Llama-2-7B-GGUF/resolve/main/llama-2-7b.Q8_0.gguf
```

4. **Run:**

```bash
cd ../build/bin/
./main -m ./models/llama-2-7b.Q8_0.gguf -p "Writing a thesis proposal can be done in 10 simple steps:\nStep 1:" -n 2048 -e -ngl 100 -t 48
```

For the llama.cpp CLI arguments you can see here:

| Short Option    | Long Option           | Param Value | Description                                                      |
| --------------- | --------------------- | ----------- | ---------------------------------------------------------------- |
| `-h`            | `--help`              |             | Show this help message and exit                                  |
| `-i`            | `--interactive`       |             | Run in interactive mode                                          |
|                 | `--interactive-first` |             | Run in interactive mode and wait for input right away            |
|                 | `-ins`, `--instruct`  |             | Run in instruction mode (use with Alpaca models)                 |
| `-r`            | `--reverse-prompt`    | `PROMPT`    | Run in interactive mode and poll user input upon seeing `PROMPT` |
|                 | `--color`             |             | Colorise output to distinguish prompt and user input from        |
| **Generations** |
| `-s`            | `--seed`              | `SEED`      | Seed for random number generator                                 |
| `-t`            | `--threads`           | `N`         | Number of threads to use during computation                      |
| `-p`            | `--prompt`            | `PROMPT`    | Prompt to start generation with                                  |
|                 | `--random-prompt`     |             | Start with a randomized prompt                                   |
|                 | `--in-prefix`         | `STRING`    | String to prefix user inputs with                                |
| `-f`            | `--file`              | `FNAME`     | Prompt file to start generation                                  |
| `-n`            | `--n_predict`         | `N`         | Number of tokens to predict                                      |
|                 | `--top_k`             | `N`         | Top-k sampling                                                   |
|                 | `--top_p`             | `N`         | Top-p sampling                                                   |
|                 | `--repeat_last_n`     | `N`         | Last n tokens to consider for penalize                           |
|                 | `--repeat_penalty`    | `N`         | Penalize repeat sequence of tokens                               |
| `-c`            | `--ctx_size`          | `N`         | Size of the prompt context                                       |
|                 | `--ignore-eos`        |             | Ignore end of stream token and continue generating               |
|                 | `--memory_f32`        |             | Use `f32` instead of `f16` for memory key+value                  |
|                 | `--temp`              | `N`         | Temperature                                                      |
|                 | `--n_parts`           | `N`         | Number of model parts                                            |
| `-b`            | `--batch_size`        | `N`         | Batch size for prompt processing                                 |
|                 | `--perplexity`        |             | Compute perplexity over the prompt                               |
|                 | `--keep`              |             | Number of tokens to keep from the initial prompt                 |
|                 | `--mlock`             |             | Force system to keep model in RAM                                |
|                 | `--mtest`             |             | Determine the maximum memory usage                               |
|                 | `--verbose-prompt`    |             | Print prompt before generation                                   |
| `-m`            | `--model`             | `FNAME`     | Model path                                                       |

### TensorRT-LLM Setup

#### **Docker and TensorRT-LLM build**

> Note: You should run with admin permission to make sure everything works fine

1. **Docker Image:**

```bash
sudo make -C docker build
```

2. **Run Container:**

```bash
sudo make -C docker run
```

Once in the container, TensorRT-LLM can be built from the source using the following:

3. **Build:**

```bash
# To build the TensorRT-LLM code.
python3 ./scripts/build_wheel.py --trt_root /usr/local/tensorrt
# Deploy TensorRT-LLM in your environment.
pip install ./build/tensorrt_llm*.whl
```

> Note: You can specify the GPU architecture (e.g. for 4090 is ADA) for compilation time reduction
> The list of supported architectures can be found in the `CMakeLists.txt` file.

```bash
python3 ./scripts/build_wheel.py --cuda_architectures "89-real;90-real"
```

#### Running TensorRT-LLM

1. **Requirements:**

```bash
pip install -r examples/bloom/requirements.txt && git lfs install
```

2. **Download Weights:**

```bash
cd examples/llama && rm -rf ./llama/7B && mkdir -p ./llama/7B && git clone https://huggingface.co/NousResearch/Llama-2-7b-hf ./llama/7B
```

3. **Build Engine:**

```bash
python build.py --model_dir ./llama/7B/ --dtype float16 --remove_input_padding --use_gpt_attention_plugin float16 --enable_context_fmha --use_gemm_plugin float16 --use_weight_only --output_dir ./llama/7B/trt_engines/weight_only/1-gpu/
```

4. Run Inference:

```bash
python3 run.py --max_output_len=2048 --tokenizer_dir ./llama/7B/ --engine_dir=./llama/7B/trt_engines/weight_only/1-gpu/ --input_text "Writing a thesis proposal can be done in 10 simple steps:\nStep 1:"
```

For the tensorRT-LLM CLI arguments, you can see in the `run.py`.
