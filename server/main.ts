import { setup } from './helpers/setup'
import { startServer as start } from './index'
/**
 * Setup extensions and start the server
 */
setup().then(() => start())
