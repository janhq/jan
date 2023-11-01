Connect to rigs
Download Pritunl
https://client.pritunl.com/#install

Import the .ovpn file

Use Vscode to connect
Hint: You need to install "Remote-SSH" extension.



Llama.cpp

Get llama.cpp
`
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
`

Build with cmake for faster result
`
mkdir build
cd build
# You can play with the params to find the best out of it
cmake .. -DLLAMA_CUBLAS=ON -DLLAMA_CUDA_F16=ON -DLLAMA_CUDA_MMV_Y=8
cmake --build . --config Release
`

Download model
`
# Back to llama.cpp
cd ..
cd models
# This will get the llama-7b-Q8 GGUF
wget https://huggingface.co/TheBloke/Llama-2-7B-GGUF/resolve/main/llama-2-7b.Q8_0.gguf
`

`
# Back to llama.cpp
`
cd llama.cpp/build/bin/
./main -m ./models/llama-2-7b.Q8_0.gguf -p "Writing a thesis proposal can be done in 10 simple steps:\nStep 1:" -n 2048 -e -ngl 100 -t 48
`



Tensorrt-LLM

The following command creates a Docker image for development:

`
sudo make -C docker build
`

Check docker images command:
`
docker images
`

The image will be tagged locally with tensorrt_llm/devel:latest. To run the container, use the following command:
`
sudo make -C docker run
`

Build TensorRT-LLM
Once in the container, TensorRT-LLM can be built from source using:
`
# To build the TensorRT-LLM code.
python3 ./scripts/build_wheel.py --trt_root /usr/local/tensorrt

# Deploy TensorRT-LLM in your environment.
pip install ./build/tensorrt_llm*.whl
`

It is possible to restrict the compilation of TensorRT-LLM to specific CUDA architectures. For that purpose, the build_wheel.py script accepts a semicolon separated list of CUDA architecture as shown in the following example:

# Build TensorRT-LLM for Ada (4090)
`
python3 ./scripts/build_wheel.py --cuda_architectures "89-real;90-real"
`

The list of supported architectures can be found in the CMakeLists.txt file.

Run Tensorrt-LLM
`
pip install -r examples/bloom/requirements.txt
git lfs install
`

Download llama weight
`
cd examples/llama
rm -rf ./llama/7B
mkdir -p ./llama/7B && git clone https://huggingface.co/NousResearch/Llama-2-7b-hf ./llama/7B
`

Build the engine with Single GPU on Llama 7B
`
python build.py --model_dir ./llama/7B/ \
                --dtype float16 \
                --remove_input_padding \
                --use_gpt_attention_plugin float16 \
                --enable_context_fmha \
                --use_gemm_plugin float16 \
                --use_weight_only \
                --output_dir ./llama/7B/trt_engines/weight_only/1-gpu/
`

Run inference. Use custom `run.py` to check the tokens/seconds
`
python3 run.py --max_output_len=2048 \
               --tokenizer_dir ./llama/7B/ \
               --engine_dir=./llama/7B/trt_engines/weight_only/1-gpu/
               --input_text Writing a thesis proposal can be done in 10 simple steps:\nStep 1:
`