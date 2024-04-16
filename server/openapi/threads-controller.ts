import { Controller, Delete, Get, Path, Route, Tags } from 'tsoa'
import { deleteBuilder, getBuilder, retrieveBuilder } from '@janhq/core/dist/types/node/api/restful/helper/builder'
import { JanApiRouteConfiguration } from '@janhq/core/dist/types/node/api/restful/helper/configuration'
import { normalizeData } from './utils'
import { DeleteObjectResponse } from './entities'

@Route('threads')
export class ThreadsController extends Controller {
  @Tags('Get all the threads')
  @Get()
  public async getThreads(){
    return getBuilder(JanApiRouteConfiguration['threads']
    ).then(normalizeData)
  }

  @Tags('Find thread by id')
  @Get(':id')
  public async findThreadById(@Path('id') id: string): Promise<{}> {
    return retrieveBuilder(JanApiRouteConfiguration['threads'], id)
  }

  @Tags('Delete thread by id')
  @Delete(':id')
  public async deleteThreadById(@Path('id') id: string): Promise<DeleteObjectResponse>{
    return deleteBuilder(JanApiRouteConfiguration['threads'], id)
  }

}
