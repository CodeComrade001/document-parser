import fs from "node:fs";
import path from "node:path";

export function resolveRelativePath(fileName: string): string {
  const resolvedPath = path.resolve(
    __dirname,
    "../../adapters/llm/llm_models",
    fileName,
  );

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Required file does not exist: "${resolvedPath}"`);
  }

  if (!fs.statSync(resolvedPath).isFile()) {
    throw new Error(
      `Expected a file but found a directory or invalid path: "${resolvedPath}"`,
    );
  }

  return resolvedPath;
}