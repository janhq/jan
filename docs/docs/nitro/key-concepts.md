---
title: Key Concepts
---

## Inference Server

An inference server is a type of server designed to process requests for running large language models and to return predictions. This server acts as the backbone for AI-powered applications, providing real-time execution of models to analyze data and make decisions.

## Batching

Batching refers to the process of grouping several tasks and processing them as a single batch. In large language models inference, this means combining multiple inference requests into one batch to improve computational efficiency, leading to quicker response times and higher throughput.

## Parallel Processing

Parallel processing involves executing multiple computations simultaneously. For web servers and applications, this enables the handling of multiple requests at the same time, ensuring high efficiency and preventing delays in request processing.

## Drogon Framework

Drogon is an HTTP application framework based on C++14/17, designed for its speed and simplicity. Utilizing a non-blocking I/O and event-driven architecture, Drogon manages HTTP requests efficiently for high-performance and scalable applications.

- **Event Loop**: Drogon uses an event loop to wait for and dispatch events or messages within a program. This allows for handling many tasks asynchronously, without relying on multi-threading.
  
- **Threads**: While the event loop allows for efficient task management, Drogon also employs threads to handle parallel operations. These "drogon threads" process multiple tasks concurrently.
  
- **Asynchronous Operations**: The framework supports non-blocking operations, permitting the server to continue processing other tasks while awaiting responses from databases or external services.
  
- **Scalability**: Drogon's architecture is built to scale, capable of managing numerous connections at once, suitable for applications with high traffic loads.