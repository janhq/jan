import { s3 } from './middleware/s3'
import { setup } from './helpers/setup'
import { startServer as start } from './index'
/**
 * Setup extensions and start the server
 */
setup().then(() => start({ storageAdataper: s3 }))
