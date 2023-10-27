---
sidebar_position: 5
title: Cloud Native
---

This is an experimental feature - expect breaking changes!

## Use Case

- User doesn't have a local GPU machine but wants to run Jan on a rented server
- User wants a quick, fast way to experiment with Jan on a rented GPU

### Getting Started

#### Run from source code

```bash
git clone https://github.com/janhq/jan
cd jan
git checkout feat-255 && git pull
yarn install
yarn start:server
```

Open your browser at [http://localhost:4000](http://localhost:4000)

### Run from docker file

```bash
git clone https://github.com/janhq/jan
cd jan
git checkout feat-255 && git pull
docker build --platform linux/x86_64 --progress=plain  -t jan-server .
docker run --platform linux/x86_64 --name jan-server  -p4000:4000 -p3928:3928 -it jan-server
```

Open your browser at [http://localhost:4000](http://localhost:4000)

### Architecture

![cloudnative](img/cloudnative.png)

### To-dos

- [Authencation Plugins](https://github.com/janhq/jan/issues/334)
- [Remote server](https://github.com/janhq/jan/issues/200)
