import fs from "fs";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

async function parseResume(filePath) {
  const buffer = fs.readFileSync(filePath);

  if (filePath.endsWith(".pdf")) {
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (filePath.endsWith(".docx")) {
    const data = await mammoth.extractRawText({ buffer });
    return data.value;
  }

  throw new Error("Unsupported file format");
}

export { parseResume };