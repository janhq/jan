import { DownloadRoute } from '../../../../api'
import { DownloadManager } from '../../../helper/download'
import { HttpServer } from '../../HttpServer'

export const downloadRouter = async (app: HttpServer) => {
  app.get(`/download/${DownloadRoute.getDownloadProgress}/:modelId`, async (req, res) => {
    const modelId = req.params.modelId

    console.debug(`Getting download progress for model ${modelId}`)
    console.debug(
      `All Download progress: ${JSON.stringify(DownloadManager.instance.downloadProgressMap)}`
    )

    // check if null DownloadManager.instance.downloadProgressMap
    if (!DownloadManager.instance.downloadProgressMap[modelId]) {
      return res.status(404).send({
        message: 'Download progress not found',
      })
    } else {
      return res.status(200).send(DownloadManager.instance.downloadProgressMap[modelId])
    }
  })
}
