# Website & Docs

This website is built using [Nextra](https://nextra.site/), a modern static website generator.

### Information Architecture

We try to **keep routes consistent** to maintain SEO.

- **`/docs/`**: Product documentation (Jan Desktop, Jan Agent).

- **`/handbook/`**: Handbook pages.

- **`/research/`**: Research content.

- **`/changelog/`**: A list of changes made to the Jan application with each release.

- **`/blog/`**: The blog index; individual posts live under `/post/`.

- **`/download/`**: Download page.

- **`/support/`**: Support page.

- **`/privacy/`**: Privacy policy.

- **`/tokamak/`**: Tokamak landing page.

## How to Contribute

Refer to the [Contributing Guide](https://github.com/janhq/jan/blob/main/CONTRIBUTING.md) for more comprehensive information on how to contribute to the Jan project.

### Pre-requisites and Installation

- [Node.js](https://nodejs.org/en/) (version 20.0.0 or higher)
- [yarn](https://yarnpkg.com/) (version 4.x; the repo pins 4.5.3 via corepack)

#### Installation

```bash
cd jan/docs
yarn install
yarn dev
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

#### Build

```bash
yarn build
```

This command generates static content into the `out` directory (`next.config.mjs` sets `output: 'export'`) and can be served using any static contents hosting service.

### Deployment

There is no `yarn deploy` script; the `jan-docs.yml` workflow builds the site and publishes `out` to Cloudflare Pages.

### Preview URL, Pre-release and Publishing Documentation

- When a pull request is created, the preview URL will be automatically commented on the pull request.

- The documentation will then be published to [https://jan.ai/](https://jan.ai/) when the pull request is merged to `main`.
