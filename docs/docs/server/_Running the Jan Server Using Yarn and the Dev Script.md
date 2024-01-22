
  
   ## Run the Jan Server Using Yarn and the Dev Script

The Jan server can be run using the `yarn dev` script. This script will start the server on port {{JAN_API_PORT}} and serve the Jan web application.

To run the server, simply open a terminal window and navigate to the Jan directory. Then, run the following command:

```
yarn dev
```

The server will start and you will see a message in the terminal window indicating that the server is running.

You can then access the Jan web application by opening a web browser and navigating to the following URL:

```
http://localhost:{{JAN_API_PORT}}
```

The Jan web application will load and you will be able to use the various features of the application, such as creating and managing threads, sending messages, and sharing files.

### Why use the `yarn dev` script?

The `yarn dev` script is the recommended way to run the Jan server because it will automatically start the server on the correct port and serve the Jan web application. Additionally, the `yarn dev` script will watch for changes to the Jan codebase and automatically restart the server when changes are made. This makes it easy to develop and test changes to the Jan application.

### How does the `yarn dev` script work?

The `yarn dev` script works by running the following commands:

1. `yarn start`
2. `webpack-dev-server --config webpack.dev.js`

The `yarn start` command starts the Jan server on port {{JAN_API_PORT}}. The `webpack-dev-server --config webpack.dev.js` command serves the Jan web application.

The `webpack-dev-server` command also watches for changes to the Jan codebase and automatically restarts the server when changes are made. This makes it easy to develop and test changes to the Jan application.

### Troubleshooting

If you are having trouble running the Jan server, here are a few things you can try:

* Make sure that you have installed the latest version of Yarn.
* Make sure that you are running the `yarn dev` script from the Jan directory.
* Make sure that port {{JAN_API_PORT}} is not already in use by another application.
* If you are still having trouble, please refer to the Jan documentation for more information.
  
  