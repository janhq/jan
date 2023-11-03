# ADR 006: jan-core-module

## Changelog

- 2023-10-19: Initial draft

## Authors

- Louis

## Status

Accepted

## Context

Currently, developers face several challenges while writing a plugin, which include:
- Registering functions using the function name as a string
- Invoking anonymous functions
- No access to native APIs or common functions for data insertion or retrieval
- Lack of communication between the app and plugins.

## Decision

Let developers install and import an npm module to develop our Plugin easier.

Upon boot, Web plugs in window modules. Its components and plugins can then import the core to access exposed functions.

![Jan Core Module](./images/jan-core-module.png)
## Consequences

Separate PRs should be created for updating the core and app. For instance, if a new app enhancement requires the core module to expose a new API, a new core update must be published on npm to prevent CI failure.

## Alternatives

## Reference
