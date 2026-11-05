# Document Parser

A modular TypeScript document-processing system designed to extract, normalize, and analyze content from different document formats. It separates deterministic document extraction from LLM-based semantic analysis, making the processing pipeline easier to extend, maintain, and validate.

## Overview

Documents often contain information in different layouts and structures. Extracting useful information from them is not just a matter of sending the entire file to an AI model.

Document Parser uses a staged processing approach:

1. Extract content using format-specific adapters.
2. Normalize extracted content into a common document representation.
3. Split content into manageable chunks.
4. Use configurable LLM providers for semantic analysis.
5. Validate generated structured data before accepting it.

The goal is to make document content easier to consume in applications involving automation, information extraction, search, and AI-assisted analysis.

## Key Features and Architecture

### Document extraction

The project is structured around format-specific extraction adapters.

Initial supported-format targets:

- PDF
- DOCX
- TXT
- Markdown
- HTML

Each format has its own extraction module, keeping format-specific implementation details separate from the rest of the application.

### Normalized document representation

Extracted content is intended to be converted into a common internal representation.

This provides a consistent structure for downstream processing, regardless of the original file format.

The normalized model is designed to accommodate information such as:

- Document metadata
- Pages and page boundaries
- Sections and headings
- Paragraphs and other content blocks
- Tables and structured content

### Chunking

The processing pipeline includes a chunking layer to divide document content into manageable sections before semantic analysis.

This helps control the amount of content sent to an LLM and provides a foundation for processing larger documents.

### Configurable LLM architecture

LLM integrations are separated from the core document-processing logic.

The architecture includes provider-specific modules and a provider registry, allowing model integrations to be managed independently of the extraction pipeline.

The intended provider architecture accommodates:

- Locally hosted language models
- Google-based model integration
- Future compatible LLM providers

### Structured analysis

The semantic-processing stage is intended for tasks that require contextual understanding, including:

- Document classification
- Entity identification
- Key information extraction
- Field mapping
- Summarization
- Semantic interpretation

LLM-generated output should be validated against an expected schema before being passed to downstream application components.

## Processing Pipeline

```text
          Input Document
                 |
                 v
        Document Identification
                 |
                 v
       Format-Specific Extractor
                 |
                 v
        Extracted Document Data
                 |
                 v
         Document Normalization
                 |
                 v
              Chunking
                 |
                 v
          LLM Semantic Analysis
                 |
                 v
          Output Validation
                 |
                 v
        Structured Document Data
```

## Project Structure

```text
document-parser/
├── adapters/
│   ├── extractors/
│   │   ├── docx/
│   │   ├── html/
│   │   ├── markdown/
│   │   ├── pdf/
│   │   └── text/
│   ├── llm/
│   │   ├── google/
│   │   ├── local/
│   │   └── provider-registry.ts
│   └── storage/
├── code/
│   └── di/
│       └── container.ts
├── controller/
│   └── DocumentController.ts
├── core/
│   ├── bootstrap.ts
│   ├── chunking/
│   ├── document/
│   ├── extraction/
│   └── normalization/
├── repositories/
├── route/
│   └── document.routes.ts
├── shared/
│   ├── config/
│   ├── constants/
│   ├── errors/
│   ├── logger/
│   └── types/
├── usecase/
│   └── DocumentAnalysisUsecase.ts
├── worker/
├── app.ts
└── server.ts
```

## Technology

- TypeScript
- Node.js
- Modular adapter-based architecture
- Dependency injection
- Local LLM integration
- External LLM provider integration

## API

The current application exposes a document upload endpoint:

```http
POST /api/document/upload
```

The local development server has been configured to run on port `4100`.

## Current Limitations

This project is under active development. The following limitations should be considered before using it in production.

### File format limitations

The initial format scope is PDF, DOCX, TXT, Markdown, and HTML.

The following formats are not currently part of the initial supported scope:

- Excel spreadsheets (XLSX)
- CSV files
- PowerPoint presentations (PPTX)
- Standalone images

Scanned PDFs and image-based documents require OCR support, which is not yet part of the implemented extraction pipeline.

### Extraction limitations

Document extraction quality depends on the source file and the capabilities of the relevant extractor.

Complex layouts, unusual tables, embedded content, and poorly formatted documents may not be represented perfectly in the normalized output.

### LLM limitations

Semantic extraction depends on the selected model and provider.

Smaller locally hosted models may have limited context capacity, weaker reasoning, or inconsistent structured-output generation.

LLM responses can contain malformed or incomplete JSON. Schema validation, retry handling, and output repair are important areas that require continued hardening.

### Local processing performance

Local inference can be resource-intensive, particularly on machines without GPU acceleration.

Processing time depends on the model, hardware, document size, and chunk count. Local processing should not be assumed to have the same performance as a hosted model.

### Security and production readiness

Documents are untrusted input. Production deployment requires robust handling of:

- Oversized files and decompression bombs
- Malformed or malicious documents
- File-type validation
- Resource and processing limits
- Prompt injection embedded in document content
- Sensitive information sent to external LLM providers

The presence of an extraction pipeline or LLM provider abstraction does not, by itself, guarantee that these security controls are fully implemented.

## Planned Improvements

Potential future improvements include:

- OCR integration for scanned PDFs and images.
- XLSX, CSV, and PPTX extraction.
- More robust table and layout preservation.
- Improved structured-output validation and automatic repair.
- Better handling of large documents and context limits.
- Processing queues and configurable concurrency.
- Extraction confidence and processing metadata.
- Expanded automated testing and production security controls.
- Additional LLM provider integrations.

## Design Principles

The project follows several architectural principles:

- Deterministic extraction before AI interpretation.
- Separation of format-specific extraction from semantic processing.
- Replaceable LLM providers.
- Consistent normalized document representations.
- Validation of generated structured output.
- Modular components with clear responsibilities.

## Project Status

**Status:** Active development.


## License

Choose and add a license before presenting the repository as open source. The license determines how other people may use, modify, and redistribute the code.
