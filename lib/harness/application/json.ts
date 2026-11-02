/**
 * Tolerant JSON extraction from model output: strips code fences and
 * reasoning preambles, then parses the outermost object.
 */
export function extractJsonObject(content: string): unknown {
  const text = content.replace(/^﻿/, "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      try {
        // Common model slips: trailing commas.
        return JSON.parse(candidate.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"));
      } catch {
        continue;
      }
    }
  }
  throw new Error(`model did not return a JSON object: ${text.slice(0, 200)}`);
}
