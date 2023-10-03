# ADR #011: Jan deployable cloud-native

## Changelog

- 23.10.03: Initial unfinished draft

## Authors

- @nam-john-ho

## Context

### Status Quo

User doesn't have a local GPU machine but wants to run Jan on a rented server
User wants a quick, fast way to experiment with Jan on a rented GPU
https://github.com/janhq/jan/issues/255

## Decision

This ADR aims to outline design decisions for deploying Jan in cloud native environments such as: Runpod, AWS, Azure, GCP in a fast and simple way.
The current code-base should not change too much.
The current plugins should be reusable across enviroments (Desktop, Cloud-native).
Simple authentication (username/password) should be supported.


### Key Design Decisions
![alt text](images/adr-001-01.png "Title")


### Detailed Design



## Alternative Approaches



## Considerations



https://www.runpod.io/console/templates
https://repost.aws/articles/ARQ0Tz9eorSL6EAus7XPMG-Q/how-to-install-textgen-webui-on-aws
https://www.youtube.com/watch?v=_59AsSyMERQ
https://gpus.llm-utils.org/running-llama-2-on-runpod-with-oobaboogas-text-generation-webui/
https://medium.com/@jarimh1984/installing-oobabooga-and-oobabooga-api-to-runpod-cloud-step-by-step-tutorial-47457974dfa5
