## Jan Backend

A Hasura Data API Platform designed to provide APIs for client interaction with the Language Model (LLM) through chat or the generation of art using Stable Diffusion. It is encapsulated within a Docker container for easy local deployment

## Quickstart
1. Run docker up

```bash
docker compose up
```

2. Install [HasuraCLI](https://hasura.io/docs/latest/hasura-cli/overview/)

3. Open Hasura Console

```bash
cd hasura && hasura console
```

4. Apply Migration

```bash
hasura migrate apply
```

5. Apply Metadata

```bash
hasura metadata apply
```

6. Apply seeds

```bash
hasura seed apply
```

## Hasura One Click Deploy
Use this URL to deploy this app to Hasura Cloud

[![Hasura Deploy](https://hasura.io/deploy-button.svg)](https://cloud.hasura.io/deploy?github_repo=https://github.com/janhq/app-backend/&hasura_dir=/hasura)

[One-click deploy docs](https://hasura.io/docs/latest/getting-started/getting-started-cloud/)

## Modify schema & model
[Hasura Tutorials](https://hasura.io/docs/latest/resources/tutorials/index/)

## Events & Workers 

Serverless function (Cloudflare worker) to stream llm message & update

Readmore about Hasura Events here:
> https://hasura.io/docs/latest/event-triggers/serverless/

## Deploy Worker
```bash
npx wrangler deploy
```
[Cloudflare Worker Guide](https://developers.cloudflare.com/workers/get-started/guide/)