import {
  deleteBuilder,
  getBuilder,
  retrieveBuilder,
} from '@janhq/core/dist/types/node/api/restful/helper/builder'
import { JanApiRouteConfiguration } from '@janhq/core/dist/types/node/api/restful/helper/configuration'
import { Controller, Route, Get, Path, Tags, Delete } from 'tsoa'

import { DeleteObjectResponse } from './entities'
import { normalizeData } from './utils'

@Route('assistants')
export class AssistantsController extends Controller {
  @Tags('Get all assistants')
  @Get()
  public async getAssistants() {
    return getBuilder(JanApiRouteConfiguration['assistants']).then(
      normalizeData
    )
  }

  @Tags('Find assistant by id')
  @Get(':id')
  public async getAssistantById(@Path('id') id: string): Promise<any> {
    return retrieveBuilder(JanApiRouteConfiguration['assistants'], id)
  }

  @Tags('Delete assistant by id')
  @Delete(':id')
  public async deleteAssistantById(
    @Path('id') id: string
  ): Promise<DeleteObjectResponse> {
    return deleteBuilder(JanApiRouteConfiguration['assistants'], id)
  }
}
