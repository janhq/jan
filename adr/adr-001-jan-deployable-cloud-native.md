# ADR #001: Jan deployable cloud-native

## Changelog

- 23.10.03: Initial unfinished draft

## Authors

- @nam-john-ho
- @louis

## Context

### Status Quo

* User doesn't have a local GPU machine but wants to run Jan on a rented server
* User wants a quick, fast way to experiment with Jan on a rented GPU
* https://github.com/janhq/jan/issues/255

## Decision

* This ADR aims to outline design decisions for deploying Jan in cloud native environments such as: Runpod, AWS, Azure, GCP in a fast and simple way.
* The current code-base should not change too much.
* The current plugins must be reusable across enviroments (Desktop, Cloud-native).
* Simple authentication (username/password) must be supported.


### Key Design Decisions
![Key Design](images/adr-001-01.png "Key Design")
Introduce 2 components in Jan:
- Middleware: responsible for routing the user interface to the appropriate platform (Electron/WebApp) that is built when packaged.
- Http server: a http server on cloud environment which interacts with plugin directly.

### Detailed Design
#### FE
- Middleware: 
  ![Middleware](images/adr-001-01.png "Middleware")
- Httpserver: TBD
- Custom build for httpweb/electron: TBD
- IPC
- Electron imports in plugins
#### Devops:
* Allow to pass username/password as environment variables
* Assign a Public IP to the instance
* Customize instance types on-demand.
- Runpod: TBD
- AWS: TBD
- Azure: TBD
- GCP: TBD

## Alternative Approaches
Separated server process runs along side with electron. https://github.com/janhq/jan/pull/184/commits/6005409a945bb0e80a61132b9eb77f47f19d0aa6 

## Considerations

## References

- https://www.runpod.io/console/templates
- https://repost.aws/articles/ARQ0Tz9eorSL6EAus7XPMG-Q/how-to-install-textgen-webui-on-aws
- https://www.youtube.com/watch?v=_59AsSyMERQ
- https://gpus.llm-utils.org/running-llama-2-on-runpod-with-oobaboogas-text-generation-webui/
- https://medium.com/@jarimh1984/installing-oobabooga-and-oobabooga-api-to-runpod-cloud-step-by-step-tutorial-47457974dfa5
