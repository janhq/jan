# ADR 007: jan-plugin-catalog

## Changelog

- 2023-10-19: Initial draft

## Authors

- Louis

## Status

Proposed

## Context

Users should be able to explore plugins, and developers need a channel to publish their plugins

Lesson learned from the Model Catalog: we hosted everything on Github and attempted to retrieve it anonymously, which cost us a lot of effort and led to a limit rate issue. Let's say there are N items in the catalog, and we attempted to send N+1 requests at a time. It was costly and led to an API limit rate issue.

## Decision

1. Combine all JSON items in the catalog into one JSON catalog. Now we just need to work with one catalog file, which means only one request, but the rate limit issue still exists.
2. CDN - there are cool services out there which support OSS projects, such as [JSDELIVR](https://www.jsdelivr.com).
3. Downloading a JSON file is not a good approach, though. Exporting a module works better. Webpack + DefinePlugin should work.
4. Since we have created a new module, we want to publish it as well. Let's publish it on npm so everyone can install and use it. This is also to add a versioning feature.
5. Installing this npm module would require the user to update their app to the latest version. Instead, let's import the remote module via CDN, which requires just a few lines of code.

![Jan Plugin Catalog](./images/jan-plugin-catalog.png)

## Consequences

## Alternatives

## Reference
