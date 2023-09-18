/* eslint-disable react-hooks/rules-of-hooks */
// Make Pluggable Electron's facade available to hte renderer on window.plugins
const useFacade = require("pluggable-electron/facade");
useFacade();
