#!/bin/bash
set -e

### Clean sub-processes on exit
trap "trap - SIGTERM && kill -- -$$" SIGINT

MAX_STEPS=13
progress() {
    local BAR_SIZE="##########"
    local MAX_BAR_SIZE="${#BAR_SIZE}"
    local CLEAR_LINE="\\033[K"
    spin[0]="-"
    spin[1]="\\"
    spin[2]="|"
    spin[3]="/"
    perc=$((($3 + 1) * 100 / MAX_STEPS))
    percBar=$((perc * MAX_BAR_SIZE / 100))

    eval "$1" >/dev/null 2>error.log &
    pid=$!

    echo -ne "\\r- [$3/$MAX_STEPS] [  ] $2 ...$CLEAR_LINE\\n"
    while kill -0 $pid >/dev/null 2>&1; do
        for i in "${spin[@]}"; do
            echo -ne "\\r\\033[1A- [$3/$MAX_STEPS] [$i] $2 $CLEAR_LINE\\n"
            sleep 0.1
        done
    done
    if [ -s "error.log" ] && [ $(cat "error.log") != "WARNING"* ]; then
        echo -ne "\\r\\033[1A- [$3/$MAX_STEPS] [x] $2\\n $(cat "error.log")"
        exit 1
    fi
    echo -ne "\\r\\033[1A- [$3/$MAX_STEPS] [✔] $2 $CLEAR_LINE\\n"
}
step=1


### macOS setup
if [[ "$OSTYPE" == "darwin"* ]]; then
    MAX_STEPS=13
    if [[ ! -x "$(command -v brew)" ]]; then
        progress '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' "Installing Homebrew" 1
    else
        progress '' "Homebrew - Installed" $((step++))
    fi

    xcode-select -p &>/dev/null
    if [ $? -ne 0 ]; then
        progress 'xcode-select --install' "Installing Xcode Command Line Tools" $((step++))
    else
        progress '' "Xcode Command Line Tools - Installed" $((step++))
    fi

    if [[ ! -x "$(command -v git)" ]]; then
        progress 'brew install git' "Installing Git" $((step++))
    else
        progress '' "Git - Installed" $((step++))
    fi

    if [[ ! -x "$(command -v wget)" ]]; then
        progress 'brew install wget' "Installing Wget" $((step++))
    else
        progress '' "Wget - Installed" $((step++))
    fi

    if [[ ! -x "$(command -v docker)" ]]; then
        progress 'brew install --cask docker' "Installing Docker" $((step++))
    else
        progress '' "Docker - Installed" $((step++))
    fi

    docker compose version &>/dev/null
    if [ $? -ne 0 ] && [ ! -x "$(command -v docker-compose)" ]; then
        progress 'brew install docker-compose' "Installing Docker Compose" $((step++))
    else
        progress '' "docker-compose - Installed" $((step++))
    fi
fi
### 

### Debian setup
if [[ "$OSTYPE" == "linux"* ]]; then
    MAX_STEPS=12
    progress "sudo apt update 2>/dev/null" "Apt Updating" $((step++))

    if [[ ! -x "$(command -v git)" ]]; then
        progress 'sudo apt install git' "Installing Git" $((step++))
    else
        progress '' "Git - Installed" $((step++))
    fi

    if [[ ! -x "$(command -v wget)" ]]; then
        progress 'sudo apt install wget' "Installing Wget" $((step++))
    else
        progress '' "Wget - Installed" $((step++))
    fi

    if [[ ! -x "$(command -v docker)" ]]; then
        progress '/bin/bash -c "$(curl -fsSL https://get.docker.com/) 2>/dev/null"' "Installing Docker" $((step++))
    else
        progress '' "Docker - Installed" $((step++))
    fi

    docker compose version &>/dev/null
    if [ $? -ne 0 ] || [ ! -x "$(command -v docker-compose)" ]; then
        progress 'sudo apt install docker-compose' "Installing Docker Compose" $((step++))
    else
        progress '' "docker-compose - Installed" $((step++))
    fi
fi
###

### Pull Jan
if [ -d "jan" ]; then
    cd jan
    progress 'git pull 2>/dev/null' "Git pull" $((step++))
else
    progress 'git clone --quiet https://github.com/janhq/jan' "Git clone" $((step++))
    cd jan
fi

progress 'git submodule update --init --recursive' "Pull submodule" $((step++))
###

### Prepare environment
progress 'cp -f sample.env .env' "Prepare .env file" $((step++))
###

### Download Model
if [ -f "jan-inference/llm/models/llama-2-7b-chat.ggmlv3.q4_1.bin" ]; then
    progress '' "Llama model - Installed" $((step++))
else
    progress 'wget https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGML/resolve/main/llama-2-7b-chat.ggmlv3.q4_1.bin -P jan-inference/llm/models' "Download Llama model" $((step++))
fi
###

### Run Llama.cpp
# pip install llama-cpp-python[server]
# python3 -m llama_cpp.server --model models/7B/ggml-model.bin
###

### Launch Docker & Docker compose up
if [[ "$OSTYPE" == "darwin"* ]]; then
    progress $'
    if (! docker stats --no-stream 2>/dev/null ); then
        open /Applications/Docker.app 
        while (! docker stats --no-stream 2>/dev/null ); do
            sleep 0.3 
        done 
    fi' "Waiting for docker to launch" $((step++))
elif [[ "$OSTYPE" == "linux"* ]]; then
    progress 'sudo service docker start 2>/dev/null' "Starting Docker Service" $((step++))
fi

docker compose version >/dev/null
if [[ "$OSTYPE" == "darwin"* ]]; then
    if [ $? == 0 ]; then
        progress 'docker compose up -d --quiet-pull --remove-orphans 2>/dev/null' "Docker compose up" $((step++))
    elif [[ -x "$(command -v docker-compose)" ]]; then
        progress 'docker-compose up -d --quiet-pull --remove-orphans 2>/dev/null' "Docker compose up" $((step++))
    fi
elif [[ "$OSTYPE" == "linux"* ]]; then
    if [ $? == 0 ]; then
        progress 'sudo docker compose up -d --quiet-pull --remove-orphans 2>/dev/null' "Docker compose up" $((step++))
    elif [[ -x "$(command -v docker-compose)" ]]; then
        progress 'sudo docker-compose up -d --quiet-pull --remove-orphans 2>/dev/null' "Docker compose up" $((step++))
    fi
fi

###

### Wait for service ready
progress $'
    while (true); do
    if curl -sL -w "%{http_code}\\n" "http://localhost:3000" -o /dev/null | grep -q "200"; then
        break
    fi
done
' "Waiting for service ready" $((step++))
###

echo -ne "\\r You can now view Jan app in the browser: http://localhost:3000 \\n"
