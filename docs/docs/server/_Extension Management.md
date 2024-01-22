
  
  

# **Extension Management in JAN**

## About Extension Management

The JAN server provides functionality to manage extensions through the `extensions` module. This allows installing, removing, and activating extensions dynamically.

## Why use Extension Management

Using the extension management API allows building a pluggable architecture for JAN. New features and functionality can be packaged into extensions that users can easily install and activate without restarting the JAN server.

## Extension Management API

The main methods available are:

- `installExtensions` - Installs an array of extension specifications
- `removeExtension` - Removes an extension by name
- `setActive` - Activates or deactivates an extension  

## Prerequisites

- The `extensions` module needs to be initialized by calling `useExtensions` and passing in the extensions path
- Access the extension management API by calling `getStore()` after initialization

## Example Usage

```
init({
  extensionsPath: '/path/to/extensions', 
});

const { 
  installExtensions,
  removeExtension  
} = getStore();

installExtensions(['extension-package']);
removeExtension('name'); 
```

The above initializes the extensions system, installs the 'extension-package', and removes the extension 'name'.


  
  