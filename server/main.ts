import { setup } from "./helpers/extension";
import { startServer as start } from "./index";
/**
 * Setup the extension and start the server
 */
setup().then(() => start());
