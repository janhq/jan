# Jan

Jan is a free, source-available and [fair code licensed](https://faircode.io/) AI Inference Platform. We help enterprises, small businesses and hobbyists to self-host AI on their own infrastructure efficiently, to protect their data, lower costs, and put powerful AI capabilities in the hands of users. 

## Features

- Web, Mobile and APIs
- LLMs and Generative Art models
- AI Catalog
- Model Installer 
- User Management
- Support for Nvidia, Apple Silicon, CPU architectures

## Installation

### Pre-Requisites

- Nvidia GPUs
- Apple Silicon
- CPU architectures (not recommended)

### Docker Compose

Jan offers an [Docker Compose](https://docs.docker.com/compose/) deployment that automates the setup process.

```shell 
# Install and update Nvidia Docker Container Runtime
nvidia-smi

# Docker Compose up
docker compose up
```

| Service (Docker)  | URL                        |
| ----------------- | -------------------------- |
| Jan Web           | localhost:1337             |
| Jan API           | localhost:1337/api         |
| Jan API (Swagger) | localhost:1337/api/swagger |
| Jan Docs          | localhost:1337/docs        |
| Keycloak Admin    | localhost:1337/users       |
| Grafana Dashboard | localhost:1337/grafana     |

## Developers

### Architecture

- [ ] Architecture Diagram

### Dependencies

* [Keycloak Community](https://github.com/keycloak/keycloak) (Apache-2.0)
* [KrakenD Community Edition](https://github.com/krakend/krakend-ce) (Apache-2.0)

### Repo Structure

Jan is a monorepo that pulls in the following submodules

```shell
├── docker-compose.yml
├── mobile-client
├── web-client
├── app-backend
├── inference-backend
├── docs                # Developer Docs
├── adrs                # Architecture Decision Records
```

