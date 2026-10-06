import { DocumentParserConstructor } from "../core/DocumentParserConstructor"


export default class DocumentAnalysisUsecase {

  constructor(
    private readonly documentParser: DocumentParserConstructor,
  ) {

  }

  public async execute(payload: any): Promise<{
    success: boolean,
    message?: string,
    data: any | null
  }> {
    // after business logic execute the 
    const { document } = this.documentParser.init()

    const result = document.parse(payload)
    console.log("Turbo Log  ~ DocumentAnalysisUsecase ~ execute ~ result:", result);

    return {
      success: true,
      message: "No implemtation found",
      data: []
    }
  }
}