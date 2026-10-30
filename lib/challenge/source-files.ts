import manifest from "@/data/case/manifest.json";

export type EvidenceFileKind = "CSV" | "PDF" | "DOCX" | "PPTX" | "PNG" | "XLSX";

export const evidenceFiles = manifest.files.map(({ fileId, format }) => ({
  name: fileId,
  type: format.toUpperCase() as EvidenceFileKind,
}));
