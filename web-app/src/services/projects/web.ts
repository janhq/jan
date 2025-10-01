/**
 * Web Projects Service - Web implementation
 * Currently extends default, will be customized by extension-web team later
 */

import { DefaultProjectsService } from './default'

export class WebProjectsService extends DefaultProjectsService {
  // Currently uses the same localStorage implementation as default
  // Extension-web team can override methods here later
}
