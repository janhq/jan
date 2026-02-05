#!/bin/bash
# Quick benchmark script for MLX server
# Usage: ./quick_bench.sh <port> <iterations> <max_tokens>

PORT=${1:-8080}
ITERATIONS=${2:-10}
MAX_TOKENS=${3:-100}
MODEL=${4:-model}

echo "MLX Quick Benchmark"
echo "==================="
echo "Port: $PORT"
echo "Iterations: $ITERATIONS"
echo "Max tokens: $MAX_TOKENS"
echo ""

# Check if server is running
if ! curl -s "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
    echo "Error: Server not running on port $PORT"
    exit 1
fi

# Run benchmark using Python script
python3 scripts/benchmark.py \
    --port "$PORT" \
    --model "$MODEL" \
    --iterations "$ITERATIONS" \
    --max-tokens "$MAX_TOKENS" \
    --output-format table