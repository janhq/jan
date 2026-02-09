#!/usr/bin/env python3
"""
MLX Server Benchmark Script

Evaluates token generation speed over multiple iterations with various configurations.

Usage:
    python3 benchmark.py --port 8080 --model llama-2-7b --iterations 10 --max-tokens 100
    python3 benchmark.py --port 8080 --batch-sizes 1,2,4,8 --compare-batching
"""

import asyncio
import aiohttp
import argparse
import json
import statistics
import time
from datetime import datetime
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from tabulate import tabulate


@dataclass
class BenchmarkConfig:
    """Configuration for benchmark run."""
    host: str = "127.0.0.1"
    port: int = 8080
    model: str = "model"
    api_key: Optional[str] = None
    iterations: int = 10
    max_tokens: int = 100
    warmup_iterations: int = 2
    prompt: str = "Hello, I am a large language model. Tell me a short story about AI."
    batch_sizes: List[int] = field(default_factory=lambda: [1])
    compare_batching: bool = False
    output_format: str = "table"  # table, json, csv


@dataclass
class BenchmarkResult:
    """Result of a single benchmark run."""
    iteration: int
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: float
    tokens_per_second: float
    ttft_ms: float  # Time to first token


@dataclass
class BatchBenchmarkResult:
    """Result of a batch benchmark run."""
    batch_size: int
    iterations: int
    results: List[BenchmarkResult]
    avg_latency_ms: float
    avg_tokens_per_second: float
    avg_ttft_ms: float
    p50_latency_ms: float
    p90_latency_ms: float
    p99_latency_ms: float
    cache_hit_rate: float
    total_requests: int
    total_tokens: int
    overall_tokens_per_second: float


class MLXBenchmark:
    """Benchmark client for MLX server."""

    def __init__(self, config: BenchmarkConfig):
        self.config = config
        self.base_url = f"http://{config.host}:{config.port}/v1"
        self.health_url = f"http://{config.host}:{config.port}/health"
        self.metrics_url = f"http://{config.host}:{config.port}/metrics"
        self.headers = {
            "Content-Type": "application/json",
        }
        if config.api_key:
            self.headers["Authorization"] = f"Bearer {config.api_key}"

    async def check_health(self) -> bool:
        """Check if server is healthy."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.health_url) as resp:
                    return resp.status == 200
        except Exception as e:
            print(f"Health check failed: {e}")
            return False

    async def get_metrics(self) -> Dict[str, Any]:
        """Get server metrics."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.metrics_url) as resp:
                    if resp.status == 200:
                        text = await resp.text()
                        return json.loads(text)
        except Exception:
            pass
        return {}

    async def make_request(
        self,
        session: aiohttp.ClientSession,
        stream: bool = False
    ) -> Dict[str, Any]:
        """Make a chat completion request."""
        payload = {
            "model": self.config.model,
            "messages": [{"role": "user", "content": self.config.prompt}],
            "max_tokens": self.config.max_tokens,
            "stream": stream,
        }

        start_time = time.perf_counter()
        ttft = None

        async with session.post(
            f"{self.base_url}/chat/completions",
            json=payload,
            headers=self.headers
        ) as resp:
            if stream:
                # For streaming, measure TTFT
                async for line in resp.content:
                    if ttft is None:
                        ttft = (time.perf_counter() - start_time) * 1000
                    if line.strip() == b"data: [DONE]":
                        break
                return {"ttft_ms": ttft}
            else:
                data = await resp.json()
                latency_ms = (time.perf_counter() - start_time) * 1000
                return {
                    "latency_ms": latency_ms,
                    "ttft_ms": latency_ms * 0.1,  # Estimate TTFT as 10% of latency
                    "data": data
                }

    def parse_result(self, response: Dict[str, Any], iteration: int) -> BenchmarkResult:
        """Parse response into benchmark result."""
        data = response.get("data", {})

        try:
            usage = data.get("usage", {})
            prompt_tokens = usage.get("prompt_tokens", 50)
            completion_tokens = usage.get("completion_tokens", self.config.max_tokens)
        except (TypeError, AttributeError):
            prompt_tokens = 50
            completion_tokens = self.config.max_tokens

        latency_ms = response.get("latency_ms", 100)
        ttft_ms = response.get("ttft_ms", latency_ms * 0.1)
        total_tokens = prompt_tokens + completion_tokens
        tokens_per_second = (total_tokens / latency_ms) * 1000 if latency_ms > 0 else 0

        return BenchmarkResult(
            iteration=iteration,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            latency_ms=latency_ms,
            tokens_per_second=tokens_per_second,
            ttft_ms=ttft_ms
        )

    async def run_single_benchmark(self, batch_size: int = 1) -> BatchBenchmarkResult:
        """Run benchmark with specified batch size."""
        print(f"\n{'='*60}")
        print(f"Benchmarking batch size: {batch_size}")
        print(f"{'='*60}")

        results: List[BenchmarkResult] = []

        async with aiohttp.ClientSession() as session:
            # Warmup
            print(f"  Warming up ({self.config.warmup_iterations} iterations)...", end=" ", flush=True)
            for i in range(self.config.warmup_iterations):
                await self.make_request(session)
            print("done")

            # Run iterations
            print(f"  Running {self.config.iterations} iterations...", end=" ", flush=True)
            for i in range(self.config.iterations):
                # For batch > 1, make concurrent requests
                if batch_size > 1:
                    tasks = [self.make_request(session) for _ in range(batch_size)]
                    responses = await asyncio.gather(*tasks)
                    for response in responses:
                        result = self.parse_result(response, i)
                        results.append(result)
                else:
                    response = await self.make_request(session)
                    result = self.parse_result(response, i)
                    results.append(result)

                if (i + 1) % 5 == 0:
                    print(f"{i+1}...", end="", flush=True)
            print("done")

        # Calculate statistics
        latencies = [r.latency_ms for r in results]
        tps_values = [r.tokens_per_second for r in results]
        ttft_values = [r.ttft_ms for r in results]

        avg_latency = statistics.mean(latencies)
        avg_tps = statistics.mean(tps_values)
        avg_ttft = statistics.mean(ttft_values)

        p50 = statistics.median(latencies)
        p90 = sorted(latencies)[int(len(latencies) * 0.9)]
        p99 = sorted(latencies)[int(len(latencies) * 0.99)]

        # Get cache metrics
        metrics = await self.get_metrics()
        cache_hit_rate = 0.0
        try:
            cache_hit_rate = float(metrics.get("cache_hit_rate", "0").replace("%", ""))
        except (ValueError, TypeError):
            pass

        return BatchBenchmarkResult(
            batch_size=batch_size,
            iterations=self.config.iterations,
            results=results,
            avg_latency_ms=avg_latency,
            avg_tokens_per_second=avg_tps,
            avg_ttft_ms=avg_ttft,
            p50_latency_ms=p50,
            p90_latency_ms=p90,
            p99_latency_ms=p99,
            cache_hit_rate=cache_hit_rate,
            total_requests=len(results),
            total_tokens=sum(r.total_tokens for r in results),
            overall_tokens_per_second=sum(r.total_tokens for r in results) / (sum(latencies) / 1000)
        )


def format_table(results: List[BatchBenchmarkResult], config: BenchmarkConfig) -> str:
    """Format results as a table."""
    table_data = []
    headers = [
        "Batch Size",
        "Requests",
        "Avg Latency",
        "P50 Latency",
        "P90 Latency",
        "Tokens/sec",
        "TTFT",
        "Cache Hit%"
    ]

    for r in results:
        table_data.append([
            r.batch_size,
            r.total_requests,
            f"{r.avg_latency_ms:.1f}ms",
            f"{r.p50_latency_ms:.1f}ms",
            f"{r.p90_latency_ms:.1f}ms",
            f"{r.avg_tokens_per_second:.1f}",
            f"{r.avg_ttft_ms:.1f}ms",
            f"{r.cache_hit_rate:.1f}%"
        ])

    return tabulate(table_data, headers=headers, tablefmt="github")


def format_json(results: List[BatchBenchmarkResult], config: BenchmarkConfig) -> str:
    """Format results as JSON."""
    output = {
        "timestamp": datetime.now().isoformat(),
        "config": {
            "host": config.host,
            "port": config.port,
            "model": config.model,
            "iterations": config.iterations,
            "max_tokens": config.max_tokens,
            "prompt_length": len(config.prompt),
        },
        "results": []
    }

    for r in results:
        output["results"].append({
            "batch_size": r.batch_size,
            "total_requests": r.total_requests,
            "total_tokens": r.total_tokens,
            "latency": {
                "avg_ms": r.avg_latency_ms,
                "p50_ms": r.p50_latency_ms,
                "p90_ms": r.p90_latency_ms,
                "p99_ms": r.p99_latency_ms,
            },
            "throughput": {
                "tokens_per_second": r.avg_tokens_per_second,
                "overall_tokens_per_second": r.overall_tokens_per_second
            },
            "ttft_ms": r.avg_ttft_ms,
            "cache_hit_rate": r.cache_hit_rate
        })

    return json.dumps(output, indent=2)


def format_csv(results: List[BatchBenchmarkResult], config: BenchmarkConfig) -> str:
    """Format results as CSV."""
    lines = [
        "batch_size,total_requests,total_tokens,avg_latency_ms,p50_latency_ms,p90_latency_ms,tokens_per_second,ttft_ms,cache_hit_rate"
    ]

    for r in results:
        lines.append(
            f"{r.batch_size},{r.total_requests},{r.total_tokens},"
            f"{r.avg_latency_ms:.2f},{r.p50_latency_ms:.2f},{r.p90_latency_ms:.2f},"
            f"{r.avg_tokens_per_second:.2f},{r.avg_ttft_ms:.2f},{r.cache_hit_rate:.2f}"
        )

    return "\n".join(lines)


async def run_benchmark(config: BenchmarkConfig) -> List[BatchBenchmarkResult]:
    """Run the complete benchmark suite."""
    print("\n" + "="*60)
    print("MLX Server Benchmark")
    print("="*60)
    print(f"  Host: {config.host}:{config.port}")
    print(f"  Model: {config.model}")
    print(f"  Iterations: {config.iterations}")
    print(f"  Max tokens: {config.max_tokens}")
    print(f"  Prompt length: {len(config.prompt)} chars")

    client = MLXBenchmark(config)

    # Check health
    print("\nChecking server health...", end=" ")
    healthy = await client.check_health()
    if healthy:
        print("OK")
    else:
        print("FAILED - Server may not be running")
        print(f"  URL: {client.health_url}")
        return []

    results: List[BatchBenchmarkResult] = []

    if config.compare_batching:
        # Test multiple batch sizes
        for batch_size in config.batch_sizes:
            result = await client.run_single_benchmark(batch_size)
            results.append(result)
    else:
        # Single benchmark
        result = await client.run_single_benchmark(config.batch_sizes[0])
        results.append(result)

    return results


def print_summary(results: List[BatchBenchmarkResult], config: BenchmarkConfig):
    """Print summary of results."""
    print("\n" + "="*60)
    print("Results Summary")
    print("="*60)

    if config.output_format == "table":
        print(format_table(results, config))
    elif config.output_format == "json":
        print(format_json(results, config))
    else:
        print(format_csv(results, config))

    # Comparison summary
    if len(results) > 1:
        baseline = results[0]
        print("\nComparison vs Baseline (batch_size=1):")
        print("-" * 40)
        for r in results[1:]:
            if r.batch_size > 1:
                latency_change = ((r.avg_latency_ms - baseline.avg_latency_ms) / baseline.avg_latency_ms) * 100
                tps_change = ((r.avg_tokens_per_second - baseline.avg_tokens_per_second) / baseline.avg_tokens_per_second) * 100
                print(f"  Batch {r.batch_size}:")
                print(f"    Latency: {latency_change:+.1f}%")
                print(f"    Throughput: {tps_change:+.1f}%")
                print(f"    Cache hit rate: {r.cache_hit_rate:.1f}%")


def main():
    parser = argparse.ArgumentParser(
        description="Benchmark MLX server token generation speed",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic benchmark with 10 iterations
  python3 benchmark.py --port 8080 --model llama-2-7b --iterations 10

  # Compare different batch sizes
  python3 benchmark.py --port 8080 --model llama-2-7b --compare-batching --batch-sizes 1,2,4,8

  # JSON output for CI/CD
  python3 benchmark.py --port 8080 --model llama-2-7b --output-format json

  # Custom prompt and max tokens
  python3 benchmark.py --port 8080 --model llama-2-7b --prompt "Your prompt here" --max-tokens 200
"""
    )

    parser.add_argument("--host", default="127.0.0.1", help="Server host")
    parser.add_argument("--port", type=int, default=8080, help="Server port")
    parser.add_argument("--model", default="model", help="Model ID")
    parser.add_argument("--api-key", default=None, help="API key for authentication")
    parser.add_argument("--iterations", type=int, default=10, help="Number of iterations")
    parser.add_argument("--warmup-iterations", type=int, default=2, help="Warmup iterations")
    parser.add_argument("--max-tokens", type=int, default=100, help="Max tokens to generate")
    parser.add_argument("--prompt", type=str,
                        default="Hello, I am a large language model. Tell me a short story about AI.",
                        help="Prompt for generation")

    # Batching options
    parser.add_argument("--compare-batching", action="store_true",
                        help="Compare different batch sizes")
    parser.add_argument("--batch-sizes", type=str, default="1",
                        help="Comma-separated list of batch sizes to test")

    # Output options
    parser.add_argument("--output-format", choices=["table", "json", "csv"],
                        default="table", help="Output format")

    args = parser.parse_args()

    # Parse batch sizes
    batch_sizes = [int(x) for x in args.batch_sizes.split(",")]

    config = BenchmarkConfig(
        host=args.host,
        port=args.port,
        model=args.model,
        api_key=args.api_key,
        iterations=args.iterations,
        warmup_iterations=args.warmup_iterations,
        max_tokens=args.max_tokens,
        prompt=args.prompt,
        batch_sizes=batch_sizes,
        compare_batching=args.compare_batching,
        output_format=args.output_format
    )

    results = asyncio.run(run_benchmark(config))

    if results:
        print_summary(results, config)


if __name__ == "__main__":
    main()