#!/bin/bash
set -e

cleanup() {
    # kill all processes whose parent is this process
    pkill -P $$
}

for sig in INT QUIT HUP TERM; do
    trap "
    cleanup
    trap - $sig EXIT
    kill -s $sig "'"$$"' "$sig"
done
trap cleanup EXIT

progress() {
    local MAX_STEPS=11
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

    echo -ne "\\r- [$3/$MAX_STEPS] [   ] $2 ...$CLEAR_LINE\\n"
    while kill -0 $pid >/dev/null 2>&1; do
        for i in "${spin[@]}"; do
            echo -ne "\\r\\033[1A- [$3/$MAX_STEPS] [$i] $2 $CLEAR_LINE\\n"
            sleep 0.1
        done
    done
    error_log="error.log"
    if [ -s "$error_log" ]; then
        echo -ne "\\r\\033[1A- [$3/$MAX_STEPS] [ x ] $2\\n $(cat "$error_log")"
        exit 1
    fi
    echo -ne "\\r\\033[1A- [$3/$MAX_STEPS] [ ✔ ] $2 $CLEAR_LINE\\n"
}
# macOS
step=1
if [[ "$OSTYPE" == "darwin"* ]]; then
    if [[ -x "$(command -v brew)" ]]; then
        progress 'brew update' "Updating Homebrew" $((step++))
    else
        progress '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' "Installing Homebrew" 1
    fi

    xcode-select -p &>/dev/null
    if [ $? -ne 0 ]; then
        progress 'xcode-select --install' "Installing Xcode Command Line Tools" $((step++))
    else
        progress '' "Installing Xcode Command Line Tools" $((step++))
    fi

    if [[ ! -x "$(command -v git)" ]]; then
        progress 'brew install git' "Installing Git" $((step++))
    else
        progress '' "Installing Git" $((step++))
    fi

    if [[ ! -x "$(command -v docker)" ]]; then
        progress 'brew install --cask docker' "Installing Docker" $((step++))
    else
        progress '' "Installing Docker" $((step++))
    fi

    if [ -x "$(command -v docker compose)" ] || [ -x "$(command -v docker-compose)" ]; then
        progress '' "Installing Docker Compose" $((step++))
    elif [[ ! -x "$(command -v docker-compose)" ]]; then
        progress 'brew install docker-compose' "Installing Docker Compose" $((step++))
    fi
fi

if [ -d "jan" ]; then
    cd jan
    progress 'git pull 2>/dev/null' "Git pull" $((step++))
else
    progress 'git clone --quiet https://github.com/janhq/jan' "Git clone" $((step++))
    cd jan
fi

cp -f sample.env .env

progress 'git submodule update --init --recursive' "Pull submodule" $((step++))

if [ -f "jan-inference/llm/models/llama-2-7b-chat.ggmlv3.q4_1.bin" ]; then
    progress '' "Download Llama model" $((step++))
else
    progress 'wget https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGML/resolve/main/llama-2-7b-chat.ggmlv3.q4_1.bin -P jan-inference/llm/models' "Download Llama model" $((step++))
fi

progress $'
    if (! docker stats --no-stream 2>/dev/null ); then
        open /Applications/Docker.app 
        while (! docker stats --no-stream 2>/dev/null ); do
            sleep 0.3 
        done 
    fi' "Waiting for docker to launch" $((step++))
if [[ -x "$(command -v docker compose)" ]]; then
    progress 'docker compose up -d --quiet-pull --remove-orphans 2>/dev/null' "Docker compose up" $((step++))
fi
if [[ -x "$(command -v docker-compose)" ]]; then
progress 'docker-compose up -d --quiet-pull --remove-orphans 2>/dev/null' "Docker compose up" $((step++))
fi

progress $'
    while (true); do
    if curl -sL -w "%{http_code}\\n" "http://localhost:3000" -o /dev/null | grep -q "200"; then
        break
    fi
done
' "Waiting for service ready" $((step++))

echo -ne "\\r You can now view Jan app in the browser: http://localhost:3000 \\n"
