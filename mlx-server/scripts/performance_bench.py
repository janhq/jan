#!/usr/bin/env python3
"""
MLX Server Performance Benchmark - Enhanced
Tests batch processing, caching, and concurrency optimizations
"""
import requests
import time
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

URL = "http://127.0.0.1:8081/v1/chat/completions"
METRICS_URL = "http://127.0.0.1:8081/metrics"

def get_metrics():
    """Get server metrics"""
    try:
        resp = requests.get(METRICS_URL, timeout=5)
        return resp.json()
    except:
        return {}

def warmup(iterations=3):
    """Warmup the model"""
    print(f"  Warming up ({iterations} requests)...", end=" ", flush=True)
    for _ in range(iterations):
        requests.post(URL, json={
            "model": "model",
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 10,
            "temperature": 0.1
        })
    print("done")

def sequential_benchmark(name, iterations, max_tokens, temperature):
    """Sequential request benchmark"""
    times = []
    tokens = []

    for i in range(iterations):
        start = time.perf_counter()
        resp = requests.post(URL, json={
            "model": "model",
            "messages": [{"role": "user", "content": "Tell me a short story about AI."}],
            "max_tokens": max_tokens,
            "temperature": temperature
        })
        elapsed = time.perf_counter() - start

        try:
            data = resp.json()
            completion_tokens = data.get("usage", {}).get("completion_tokens", max_tokens)
        except:
            completion_tokens = max_tokens

        times.append(elapsed)
        tokens.append(completion_tokens)

    return times, tokens

def parallel_benchmark(name, iterations, max_tokens, temperature, concurrency):
    """Parallel request benchmark - tests batch processing"""
    def make_request(i):
        start = time.perf_counter()
        resp = requests.post(URL, json={
            "model": "model",
            "messages": [{"role": "user", "content": f"Tell me about topic {i} briefly."}],
            "max_tokens": max_tokens,
            "temperature": temperature
        })
        elapsed = time.perf_counter() - start

        try:
            data = resp.json()
            completion_tokens = data.get("usage", {}).get("completion_tokens", max_tokens)
        except:
            completion_tokens = max_tokens

        return elapsed, completion_tokens

    times = []
    total_tokens = 0

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(make_request, i) for i in range(iterations)]
        for future in as_completed(futures):
            elapsed, tokens = future.result()
            times.append(elapsed)
            total_tokens += tokens

    return times, total_tokens

def print_stats(name, times, total_tokens, parallel=False):
    """Print benchmark statistics"""
    avg_time = sum(times) / len(times)
    total_time = sum(times)
    tps = total_tokens / total_time if total_time > 0 else 0
    sorted_times = sorted(times)

    print(f"\n  Results:")
    print(f"    Total requests: {len(times)}")
    if parallel:
        print(f"    Wall clock time: {total_time*1000:.0f}ms")
    print(f"    Avg latency: {avg_time*1000:.0f}ms")
    print(f"    Total tokens: {total_tokens}")
    print(f"    Throughput: {tps:.1f} tokens/sec")
    print(f"    P50 latency: {sorted_times[len(times)//2]*1000:.0f}ms")
    print(f"    P90 latency: {sorted_times[int(len(times)*0.9)]*1000:.0f}ms")
    print(f"    P99 latency: {sorted_times[int(len(times)*0.99)]*1000:.0f}ms")

    return tps

def main():
    print("="*60)
    print("MLX Server Performance Benchmark")
    print("="*60)

    # Get initial metrics
    metrics = get_metrics()
    if metrics:
        print(f"\nInitial metrics: {json.dumps(metrics, indent=2)}")

    print("\n" + "="*60)
    print("SEQUENTIAL BENCHMARKS")
    print("="*60)

    warmup()

    configs = [
        ("Baseline (temp=0.7, 50 tokens)", 0.7, 50),
        ("Temp=0.1, 50 tokens", 0.1, 50),
        ("Temp=0.7, 100 tokens", 0.7, 100),
        ("Temp=0.1, 100 tokens", 0.1, 100),
    ]

    seq_results = []
    for name, temp, tokens in configs:
        print(f"\n{'='*50}")
        print(f"{name}")
        print(f"{'='*50}")

        times, tkns = sequential_benchmark(name, iterations=10, max_tokens=tokens, temperature=temp)
        tps = print_stats(name, times, sum(tkns))
        seq_results.append((name, tps))

    print("\n" + "="*60)
    print("PARALLEL BENCHMARKS (Batch Processing Test)")
    print("="*60)

    # Test with different concurrency levels
    concurrency_levels = [2, 4, 8]

    parallel_results = []
    for concurrency in concurrency_levels:
        print(f"\n{'='*50}")
        print(f"Parallel Benchmark (concurrency={concurrency})")
        print(f"{'='*50}")

        warmup()

        start = time.perf_counter()
        times, total_tokens = parallel_benchmark(
            "parallel", iterations=20, max_tokens=50, temperature=0.7, concurrency=concurrency
        )
        wall_time = time.perf_counter() - start

        tps = print_stats(f"parallel_{concurrency}", times, total_tokens, parallel=True)
        parallel_results.append((f"concurrency={concurrency}", tps, wall_time))

        # Check metrics
        metrics = get_metrics()
        if metrics:
            print(f"\n  Metrics after test: {json.dumps(metrics, indent=4)}")

    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)

    print("\nSequential benchmarks (tokens/sec):")
    for name, tps in sorted(seq_results, key=lambda x: -x[1]):
        print(f"  {name}: {tps:.1f}")

    print("\nParallel benchmarks (throughput):")
    for name, tps, wall_time in sorted(parallel_results, key=lambda x: -x[1]):
        print(f"  {name}: {tps:.1f} tokens/sec (wall: {wall_time*1000:.0f}ms)")

    print("\n" + "="*60)
    print("OPTIMIZATION VERIFICATION")
    print("="*60)
    print("""
    Expected improvements from optimizations:
    1. Parallel batch execution: Higher throughput with concurrent requests
    2. String building optimization: Lower latency for long generations
    3. Continuous batching: Better GPU utilization
    4. Improved hash function: Better cache hit rates
    5. Priority queue: Better QoS for high-priority requests
    """)

if __name__ == "__main__":
    main()