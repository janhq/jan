#!/usr/bin/env python3
"""
Simple MLX benchmark with warmup
"""
import requests
import time
import json

URL = "http://127.0.0.1:8081/v1/chat/completions"

def benchmark(name, iterations=10, max_tokens=100, temperature=0.7):
    # Warmup
    print(f"  Warming up (3 requests)...", end=" ")
    for _ in range(3):
        requests.post(URL, json={"model":"model","messages":[{"role":"user","content":"hi"}],"max_tokens":10,"temperature":temperature})
    print("done")

    times = []
    tokens = []

    print(f"  Running {iterations} iterations...", end=" ")
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
        if (i + 1) % 5 == 0:
            print(f"{i+1}...", end="")
    print("done")

    avg_time = sum(times) / len(times)
    total_tokens = sum(tokens)
    avg_tps = total_tokens / sum(times)

    print(f"\n  Results:")
    print(f"    Avg latency: {avg_time*1000:.0f}ms")
    print(f"    Total tokens: {total_tokens}")
    print(f"    Avg tokens/sec: {avg_tps:.1f}")
    print(f"    P50 latency: {sorted(times)[len(times)//2]*1000:.0f}ms")
    print(f"    P90 latency: {sorted(times)[int(len(times)*0.9)]*1000:.0f}ms")

    return avg_tps, avg_time

if __name__ == "__main__":
    print("="*50)
    print("MLX Server Performance Benchmark")
    print("="*50)
    print()

    # Test different configurations
    configs = [
        ("Baseline (temp=0.7, 100 tokens)", 0.7, 100),
        ("Temp=0.1, 100 tokens", 0.1, 100),
        ("Temp=0.7, 50 tokens", 0.7, 50),
        ("Temp=0.9, 100 tokens", 0.9, 100),
        ("High temp=1.0, 100 tokens", 1.0, 100),
    ]

    results = []
    for name, temp, tokens in configs:
        print(f"\n{'='*50}")
        print(f"{name}")
        print(f"{'='*50}")
        tps, latency = benchmark(name, iterations=10, max_tokens=tokens, temperature=temp)
        results.append((name, tps))

    print("\n" + "="*50)
    print("SUMMARY")
    print("="*50)
    for name, tps in sorted(results, key=lambda x: -x[1]):
        print(f"  {name}: {tps:.1f} tokens/sec")