import {
  deleteBuilder,
  getBuilder,
  retrieveBuilder,
} from '@janhq/core/dist/types/node/api/restful/helper/builder'
import { JanApiRouteConfiguration } from '@janhq/core/dist/types/node/api/restful/helper/configuration'
import { Controller, Route, Get, Path, Tags, Delete } from 'tsoa'

import { DeleteObjectResponse } from './entities'
import { normalizeData } from './utils'

@Route('models')
export class ModelsController extends Controller {
  @Tags('Get all models')
  @Get()
  public async getModels() {
    return getBuilder(JanApiRouteConfiguration['models']).then(normalizeData)
  }

  @Tags('Find model by id')
  @Get(':id')
  public async getModelById(
    @Path('id') id: string
  ): Promise<any> {
    return retrieveBuilder(JanApiRouteConfiguration['models'], id)
  }

  @Tags('Delete model by id')
  @Delete(':id')
  public async deleteModelById(
    @Path('id') id: string
  ): Promise<DeleteObjectResponse> {
    return deleteBuilder(JanApiRouteConfiguration['models'], id)
  }
}
