import DocumentAnalysisUsecase from "../usecase/DocumentAnalysisUsecase";

export default class DocumentController {

  constructor(
    private readonly documentAnalysisUsecase: DocumentAnalysisUsecase,
  ) { }

  public async UploadDocumentForAnalysis(request: any, reply: any) {
    try {

      const payload = await this.documentAnalysisUsecase.execute()


      return reply.code(200).send({ success: true, jobId: "" });
    } catch (error) {
      console.error("Code graph request failed:", error);

      return reply.code(500).send({
        success: false,
        message: "Internal server error",
      });
    }
  }

} 