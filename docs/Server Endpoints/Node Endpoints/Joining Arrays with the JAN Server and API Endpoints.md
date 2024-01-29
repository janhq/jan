
  
   # **app.post(`/app/${AppRoute.joinPath}`)**

## About the JAN Server and API Endpoints

Jan endpoints are endpoints from the JAN node js libary that run on port 1337.
  
## Why should I use this API Endpoint
This endpoint is used to join multiple arrays together into a single array.

## What is the query or body params required?
The body of the request should be an array of arrays.

## Prequsites
None

## What is an example Curl to this endpoint
```
curl -X POST http://localhost:1337/app/joinPath -H 'Content-Type: application/json' -d '[["a", "b", "c"], ["d", "e", "f"]]'
```

## Example Response
```
["a", "b", "c", "d", "e", "f"]
```
  
  