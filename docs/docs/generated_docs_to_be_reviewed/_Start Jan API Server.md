
  
  

# Start the Jan API Server

The `startServer` async method is used to start the Jan API server. It handles setting up the Fastify server instance, registering plugins, attaching routers, and starting the server listening on the configured host and port.

## Usage

`startServer` takes two optional parameters:

- `schemaPath` - The path to the OpenAPI schema file to use for the Swagger docs. Defaults to `"./../docs/openapi/jan.yaml"`.
- `baseDir` - The base directory to use for Swagger UI static assets. Defaults to `"./../docs/openapi"`.

## Implementation Details

- Creates a Fastify server instance with logging configured
- Registers the `@fastify/cors` and `@fastify/swagger` plugins
- Registers Swagger UI using `@fastify/swagger-ui`
- Registers a plugin to serve static files from the extensions directory 
- Attaches the `v1Router` router for API v1 routes
- Starts listening on the configured `JAN_API_HOST` and `JAN_API_PORT` environment variables
- Wraps everything in a try/catch block and logs any errors

## Configuration

The following environment variables can be used to configure the server:

- `JAN_API_HOST` - Host to listen on. Defaults to `"127.0.0.1"` 
- `JAN_API_PORT` - Port to listen on. Defaults to `"1337"`
- `EXTENSION_ROOT` - Root directory for extensions. Defaults to `"{{homedir}}/jan/extensions"`


  
  