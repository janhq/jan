import { join } from 'path'
import { app } from 'electron'

export const userSpacePath = join(app.getPath('home'), 'jan')
