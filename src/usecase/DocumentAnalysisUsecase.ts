import { DocumentParserResult } from "../core/document/DocumentParserResult";
import { DocumentParserPayload } from "../core/document/DocumentTypes";
import { DocumentParserConstructor } from "../core/DocumentParserConstructor"


export default class DocumentAnalysisUsecase {

  constructor(
    private readonly documentParser: DocumentParserConstructor,
  ) {

  }

  public async execute(payload: DocumentParserPayload[]): Promise<{
    success: boolean,
    message?: string,
    data: DocumentParserResult[] | null
  }> {
    // after business logic execute the 
    const { document } = this.documentParser.init()

    const result = await Promise.all(payload.map(async (payload) => {
      return await document.parse(payload);
    }));
    console.log("Turbo Log  ~ DocumentAnalysisUsecase ~ execute ~ result:", result);

    return {
      success: true,
      message: "No implemtation found",
      data: result
    }
  }
}