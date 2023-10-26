# ADR 008: Extensible-Jan-with-Docker

## Changelog

- 2023-10-24: Initial draft

## Authors

- @vuonghoainam

## Status
Proposed

## Context

What is the issue that we're seeing that is motivating this decision or change?
- The A.I world is moving fast with multiple runtime/ prebaked environment. We or the builder cannot cover just everything but rather we should adopt it and facillitate it as much as possible within Jan.
- For `Run your own A.I`: Builder can build app on Jan (NodeJS env) and connect to external endpoint which serves the real A.I
  - e.g 1: Nitro acting as proxy to `triton-inference-server` running within a Docker container controlled by Jan app
  - e.g 2: Original models can be in many formats (pytorch, paddlepaddle). In order to run it with the most optimized version locally, there must be a step to transpile the model ([Ollama import model](https://github.com/jmorganca/ollama/blob/main/docs/import.md), Tensorrt). Btw Jan can prebuilt it and let user pull but later
- For `Build your own A.I`: User can fine tune model locally (of course Jan help it with remote but later)

## Decision

What is the change that we're proposing and/or doing?
- Add Docker client as Core module - [Docker node](https://github.com/apocas/dockerode)
- 2 example A.I app (adr-002) to demonstrate it and actually use!

## Consequences

What becomes easier or more difficult to do because of this change?
- We can extend limitlessly :D 

## Alternatives

## Reference
