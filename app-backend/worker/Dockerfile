# Dockerfile

# alpine does not work with wrangler
FROM node 

RUN mkdir -p /worker

WORKDIR /worker

RUN npm install -g wrangler

COPY . /worker

EXPOSE 8787

CMD ["wrangler", "dev"]