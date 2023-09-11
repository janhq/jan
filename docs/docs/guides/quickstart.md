---
sidebar_position: 2
title: Quick Start Guide
---

> ⚠️ **Jan is currently in Development**: Expect breaking changes and bugs!

> [!NOTE]  
> Instruction below is for testing only, to deploy Jan to your production environment, checkout out the [Production Installation Guide](./installation.md) (in progress)


## Step 1: Install Docker

Jan is currently packaged as a Docker Compose application. 

- Docker ([Installation Instructions](https://docs.docker.com/get-docker/))
- Docker Compose ([Installation Instructions](https://docs.docker.com/compose/install/))

## Step 2: Clone Repo

```bash
git clone https://github.com/janhq/jan.git
cd jan

# Pull latest submodules
git submodule update --init --recursive
```

## Step 3: Configure `.env`

We provide a sample `.env` file that you can use to get started.

```shell
cp sample.env .env
```

You will need to set the following `.env` variables

```shell
# TODO: Document .env variables
```

## Step 4: Install Models

> Note: This step will change soon with [Nitro](https://github.com/janhq/nitro) becoming its own library

We recommend that Llama2-7B (4-bit quantized) as a basic model to get started. 

You will need to download the models to the `jan-inference/llms/models` folder. 

```shell
cd jan-inference/llms/models

# Downloads model (~4gb)
# Download time depends on your internet connection and HuggingFace's bandwidth
wget https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGML/resolve/main/llama-2-7b-chat.ggmlv3.q4_1.bin 
```

## Step 5: `docker compose up`

Jan utilizes Docker Compose to run all services:

```shell
docker compose up
docker compose up -d # Detached mode
```
-  (Backend)
- [Keycloak](https://www.keycloak.org/) (Identity)

The table below summarizes the services and their respective URLs and credentials.

| Service                                          | Container Name       | URL and Port          | Credentials                                                                        |
| ------------------------------------------------ | -------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| Jan Web                                          | jan-web-*            | http://localhost:3000 | Set in `conf/keycloak_conf/example-realm.json` <br />- Default Username / Password |
| [Hasura](https://hasura.io) (Backend)            | jan-graphql-engine-* | http://localhost:8080 | Set in `conf/sample.env_app-backend` <br /> - `HASURA_GRAPHQL_ADMIN_SECRET`        |
| [Keycloak](https://www.keycloak.org/) (Identity) | jan-keycloak-*       | http://localhost:8088 | Set in `.env` <br />- `KEYCLOAK_ADMIN` <br />- `KEYCLOAK_ADMIN_PASSWORD`           |
| Inference Service                                | jan-llm-*            | http://localhost:8000 | Set in `.env`                                                                      |
| PostgresDB                                       | jan-postgres-*       | http://localhost:5432 | Set in `.env`                                                                      |

## Step 6: Configure Keycloak

- [ ] Refactor [Keycloak Instructions](KC.md) into main README.md
- [ ] Changing login theme

## Step 7: Use Jan

- Launch the web application via `http://localhost:3000`.
- Login with default user (username: `username`, password: `password`)

## Step 8: Deploying to Production

- [ ] TODO
