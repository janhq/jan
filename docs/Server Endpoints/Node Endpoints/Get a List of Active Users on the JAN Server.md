
  
   ## Get a List of Active Users on the JAN Server

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js library that run on port 1337. These endpoints provide a way to interact with the JAN server and its various features.

## Why should I use this API Endpoint

The `/users/active` endpoint provides a way to retrieve a list of all active users on the JAN server. This can be useful for getting a quick overview of who is currently logged in to the server.

## What is the query or body params required?

This endpoint does not require any query or body parameters.

## Prequsites

Before you can use this endpoint, you must have a JAN server running on port 1337. You can start a JAN server by running the following command:

```
npm start
```

## What is an example Curl to this endpoint.

The following curl command will retrieve a list of all active users on the JAN server:

```
curl http://localhost:1337/users/active
```

## Output

The output of the curl command will be a JSON array of objects, each representing an active user. Each object will contain the following properties:

* `id`: The unique ID of the user.
* `username`: The username of the user.
* `email`: The email address of the user.
* `last_login`: The date and time of the user's last login.

## Why and How

The `/users/active` endpoint can be used for a variety of purposes, such as:

* Getting a quick overview of who is currently logged in to the JAN server.
* Identifying users who have been inactive for a long period of time.
* Troubleshooting login issues.

To use the `/users/active` endpoint, simply send a GET request to the `/users/active` endpoint. The server will respond with a JSON array of objects, each representing an active user.
  
  