
  
   ## Using the JAN Server and API Endpoints

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js library that run on port 1337. These endpoints provide a way to interact with the JAN server and its various features, such as creating and managing models, assistants, and threads.

## Why should I use this API Endpoint

The `/chat/completions` endpoint is a powerful tool for generating human-like text. It can be used for a variety of purposes, such as:

* **Natural language processing:** The endpoint can be used to perform natural language processing tasks, such as sentiment analysis, named entity recognition, and machine translation.
* **Chatbots:** The endpoint can be used to create chatbots that can interact with users in a natural way.
* **Content generation:** The endpoint can be used to generate text for a variety of purposes, such as articles, blog posts, and social media posts.

## What is the query or body params required?

The `/chat/completions` endpoint requires the following query or body parameters:

* **model:** The ID of the model to use for generation.
* **prompt:** The text prompt to use for generation.
* **max_tokens:** The maximum number of tokens to generate.

## Prequsites

Before you can use the `/chat/completions` endpoint, you must first:

1. Install the JAN node.js library.
2. Create a JAN account.
3. Create a model.

## What is an example Curl to this endpoint.

The following is an example curl command that you can use to call the `/chat/completions` endpoint:

```
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"model": "text-bison-001", "prompt": "Hello, world!", "max_tokens": 10}' \
  http://localhost:1337/chat/completions
```

This command will generate 10 tokens of text using the "text-bison-001" model and the "Hello, world!" prompt.

## Why and How

The `/chat/completions` endpoint uses a machine learning model to generate text. The model is trained on a large dataset of text, and it learns to predict the next word in a sequence of words. When you provide a prompt to the endpoint, the model uses this prompt to generate a sequence of words that are likely to follow the prompt.

The `/chat/completions` endpoint is a powerful tool that can be used for a variety of purposes. However, it is important to use the endpoint responsibly. For example, you should not use the endpoint to generate text that is harmful or offensive.
  
  