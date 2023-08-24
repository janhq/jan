# Inference - LLM

```bash
docker network create traefik_public
cp .env.example .env
# -> Update MODEL_URL in `.env` file
docker compose up -d --scale llm=2
``````
