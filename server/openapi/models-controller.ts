import { Controller, Route, Get, Path, Tags } from 'tsoa'
import { getBuilder, retrieveBuilder } from '@janhq/core/dist/types/node/api/restful/helper/builder'
import { JanApiRouteConfiguration } from '@janhq/core/dist/types/node/api/restful/helper/configuration'
const normalizeData = (data: any) => {
  return {
    object: 'list',
    data,
  }
}
@Route('models')
export class ModelsController extends Controller {
  @Tags('Get all models')
  @Get()
  public async getModels(){
    return getBuilder(JanApiRouteConfiguration['models']
    ).then(normalizeData)
  }

  @Tags('Find model by id')
  @Get(":id")
  public async getModelsById(
    @Path('id') id: string,
  ): Promise<{}>{
    return retrieveBuilder(JanApiRouteConfiguration["models"], id)
  }
}

