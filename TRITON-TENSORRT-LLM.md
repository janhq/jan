# Overview
This document includes instructions for running the Jan Server integrated with TensorRT LLM.

# Steps to Proceed

## Step 1: Clone the Jan Repo

```bash
git clone https://github.com/janhq/jan.git
cd jan

git submodule update --init --recursive
```

## Step 2: Download the model from Hugging Face. You can use llama2 or Mistral for experimentation. In this example, we will use Mistral. (For llama2, you will need to request access to Meta's repo and create a token for authentication when cloning the repo).

```bash
# On ubuntu you mayneed to install git-lfs firsh `sudo apt install git-lfs`
git lfs install

git clone https://huggingface.co/mistralai/Mistral-7B-v0.1
```

## Step 3: Build the TensorRT Engine and model

```bash
cd triton_tensorrtllm_backend/tensorrt_llm

# Depending on your GPU architecture, select the corresponding command below

# Build with CUDA Ada and Hopper architecture (40x0, ...)
make -C docker release_build CUDA_ARCHS="89-real;90-real"

# Build with Ampere achitecture (A100, ...)
make -C docker release_build CUDA_ARCHS="80-real;86-real"

# After successfully building the image (this process will take a while depending on your CPU, for example, it takes about 20 minutes on my machine

# Execute the following command to enter the container and build the model
# Start and execute into the container, you need to replace with the absolute path to the Mistral folder you just cloned in the previous step.
docker run --rm -it --ipc=host \
    --ulimit memlock=-1 --ulimit stack=67108864 \
    --gpus=all \
    --volume <Mistral_path>:/Mistral-7B-v0.1 \
    --env "CCACHE_DIR=/code/tensorrt_llm/cpp/.ccache" \
    --env "CCACHE_BASEDIR=/code/tensorrt_llm" \
    --workdir /app/tensorrt_llm \
    --name tensorrt_llm-release-test \
    --tmpfs /tmp:exec \
    tensorrt_llm/release:latest /bin/bash

# Convert the model using tensorrt-llm. Here, I follow the TensorRT instructions by using the llama example script.

cd examples/llama

python3 convert_checkpoint.py --model_dir /Mistral-7B-v0.1/ \
                              --output_dir /Mistral-7B-v0.1/tllm_checkpoint_1gpu_fp16 \
                              --dtype float16

trtllm-build --checkpoint_dir /Mistral-7B-v0.1//tllm_checkpoint_1gpu_fp16 \
            --output_dir /Mistral-7B-v0.1/7B/trt_engines/fp16/1-gpu \
            --gemm_plugin float16

# After converting the model, you will find the config.json and rank0.engine files in the folder /Mistral-7B-v0.1/7B/trt_engines/fp16/1-gpu. Since it is mounted from the host machine, these files will also be accessible there. At this point, you can shut down the container. You can exit the container by typing 'ctrl + D' or typing 'exit'.

# After exiting the container used for converting the TensorRT engine, you can keep the above container to convert more models if needed. Next, we will build the Triton TensorRT LLM backend. The reason for building is that the current Triton TensorRT LLM backend has parameter changes compared to older versions, so it needs to be rebuilt with the correct commit that you used to build the TensorRT engine above to be usable. If you want to use an existing Triton image from NVIDIA, you need to pay attention to select the correct commit of TensorRT LLM to convert the model; otherwise, you will not be able to start the model.

# Return to the triton_tensorrtllm_backend folder

cd ..

# Build the Triton TensorRT LLM backend. This build process will take a long time; for instance, it took over an hour on my machine, depending on your machine's speed. So, please be aware of this before starting the build.
DOCKER_BUILDKIT=1 docker build -t triton_trt_llm -f dockerfile/Dockerfile.trt_llm_backend .

# After successfully building the Triton TensorRT LLM backend, the next step is to create a configuration format for your model. Here, we will create a configuration for the Mistral model.

# First, we need to create a folder to store the model template using the template provided in the Triton repository.
cp -r all_models/inflight_batcher_llm all_models/mistral_7b

# Next, we copy the config.json and rank0.engine files from the /Mistral-7B-v0.1/7B/trt_engines/fp16/1-gpu folder to the folder we just created above. This command needs to be executed with sudo because the files created in the container are running as root.
cp Mistral-7B-v0.1/7B/trt_engines/fp16/1-gpu/* all_models/mistral_7b/tensorrt_llm/1/

# After that we need to run a temporary container to execute the fill_template.py script to create the configuration for our model. This command will generate the config.pbtxt file in the all_models/mistral_7b folder.

docker run --rm -it
    --volume $(pwd)/tools:/app/tools \
    --volume $(pwd)/all_models:/all_models \
    --workdir /app/
    triton_trt_llm /bin/bash

# After executing into the container, we will run the following commands to fill in the configuration file for our model set.
python3 tools/fill_template.py --in_place /all_models/mistral_7b/tensorrt_llm/config.pbtxt decoupled_mode:true,engine_dir:/all_models/mistral_7b/tensorrt_llm/1,batch_scheduler_policy:guaranteed_no_evict,kv_cache_free_gpu_mem_fraction:0.9,max_num_sequences:32,batching_strategy:inflight_fused_batching,max_beam_width:1,triton_max_batch_size:8,max_queue_delay_microseconds:0,exclude_input_in_output:True,enable_trt_overlap:False

python3 tools/fill_template.py --in_place /all_models/mistral_7b/preprocessing/config.pbtxt tokenizer_type:llama,tokenizer_dir:/tokenizer,triton_max_batch_size:8,preprocessing_instance_count:1

python3 tools/fill_template.py --in_place /all_models/mistral_7b/postprocessing/config.pbtxt tokenizer_type:llama,tokenizer_dir:/tokenizer,triton_max_batch_size:8,postprocessing_instance_count:1

python3 tools/fill_template.py --in_place /all_models/mistral_7b/tensorrt_llm_bls/config.pbtxt tokenizer_type:llama,tokenizer_dir:/tokenizer,triton_max_batch_size:8,bls_instance_count:1,decoupled_mode:true

python3 tools/fill_template.py --in_place /all_models/mistral_7b/ensemble/config.pbtxt tokenizer_type:llama,tokenizer_dir:/tokenizer,triton_max_batch_size:8,ensemble_count:1,decoupled_mode:true


# After completing the above commands, you can exit the container by typing 'exit' or pressing 'Ctrl + D'.

# Finally, we will run the Triton server with our model using the following command
docker run --rm -it --net host --shm-size=2g --ulimit memlock=-1 --ulimit stack=67108864 --gpus 0 -v $(pwd)/Mistral-7B-v0.1:/tokenizer -v $(pwd)/all_models/mistral_7b:/models-registry triton_trt_llm tritonserver --model-repository=/models-registry

# You can try using curl to test the model as follows
curl -X POST localhost:8000/v2/models/tensorrt_llm_bls/generate -d '{"text_input": "What is machine learning?", "max_tokens": 20, "bad_words": "", "stop_words": ""}'

# The result will be as follows
# {"context_logits":0.0,"cum_log_probs":0.0,"generation_logits":0.0,"model_name":"tensorrt_llm_bls","model_version":"1","output_log_probs":[0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0],"text_output":"\n\nMachine learning is a subset of artificial intelligence that focuses on the development of computer programs that can"}
```

> For more information about the configurations of Triton TensorRT LLM, please refer to the documentation. Note that if you change the commit or version of Triton TensorRT LLM, you must follow the instructions for that specific version of TensorRT LLM to convert your model, as parameters may change.

## Step 4: Start the Jan Server and Triton TensorRT LLM using Docker Compose.



## Step 5: Test the model on the Jan Server via the URL.