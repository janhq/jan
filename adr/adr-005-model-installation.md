# ADR 005: model-installation

## Changelog

- 2023-10-18: Initial draft

## Authors

- 0xSage

## Status

Proposed

## Context

There are a few issues with our current model installation method (hardcoding jsons in /models repo):

- Users want to add their own model binaries
- Maintaining /models is too manual

## Decision

Let Users download models on their own & manually import them to Jan via a "add a model" UI

Links:

- Github issue: https://github.com/janhq/jan/issues/359
- Related issue: https://github.com/janhq/jan/issues/304
- Designs: https://www.figma.com/file/JdK7cNIBeVdYeHxKiYeWtk/JAN---Web?type=design&node-id=4092-58218&mode=design&t=8OmFSG0E6I8Y3IjY-0

## Consequences

Closed alternate solutions:

- https://github.com/janhq/jan/issues/328

## Alternatives

Thinking through the model selection experience, there are a few possibilities:

1. [current] We hardcode models (via Github) to show up in Explore Models => unnecessarily manual, missing models users want
1. We mirror HF models for a faster download => users can also do nitro add llama2
1. [CHOSEN] Users download models on their own & manually import them to Jan via a "add a model" UI => I like this option actually
1. [LATER] Users paste in a HF link and download the model in Explore Models => do we still render model cards for them?
1. Users manage their own models folder, e.g. /Users/nicole/models, then they set folder path in Jan. => this one needs a lot of designs/fe work

## Reference
