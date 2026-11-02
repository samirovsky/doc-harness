import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";

/**
 * Minimal order-preserving XML tree for OOXML parts (DOCX/PPTX/XLSX).
 *
 * Tags are reduced to their LOCAL name ("w:p" → "p", "x:sheet" → "sheet")
 * because generators choose arbitrary namespace prefixes (e.g. the OpenXML
 * SDK writes `<x:workbook>`). Attributes keep their qualified names, since
 * local names can collide (`id` vs `r:id`); use `attribute()` / `relId()`.
 * `mc:Fallback` subtrees are dropped: they duplicate the `mc:Choice` content.
 */
export interface XmlNode {
  tag: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text?: string;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: true,
});

type RawNode = Record<string, unknown> & { ":@"?: Record<string, string> };

const localName = (qualified: string) => qualified.slice(qualified.indexOf(":") + 1);

function convert(raw: RawNode[]): XmlNode[] {
  const nodes: XmlNode[] = [];
  for (const entry of raw) {
    const qualified = Object.keys(entry).find((key) => key !== ":@");
    if (!qualified) continue;
    if (qualified === "#text") {
      nodes.push({ tag: "#text", attributes: {}, children: [], text: String(entry[qualified]) });
      continue;
    }
    const tag = localName(qualified);
    if (tag === "Fallback") continue;
    nodes.push({ tag, attributes: entry[":@"] ?? {}, children: convert((entry[qualified] as RawNode[]) ?? []) });
  }
  return nodes;
}

export function parseXml(xml: string): XmlNode[] {
  return convert(parser.parse(xml.replace(/^﻿/, "")) as RawNode[]);
}

/** Attribute by local name; `prefixed` restricts to namespace-qualified attributes (e.g. r:id). */
export function attribute(node: XmlNode, name: string, prefixed = false): string | undefined {
  if (!prefixed && name in node.attributes) return node.attributes[name];
  const key = Object.keys(node.attributes).find((candidate) => candidate.endsWith(`:${name}`));
  return key ? node.attributes[key] : undefined;
}

/** Relationship id attribute (r:id, r:embed, r:dm …) whatever the prefix. */
export const relId = (node: XmlNode, name = "id") => attribute(node, name, true);

/** Depth-first search for descendants with the given local tag (does not descend into matches). */
export function findAll(nodes: XmlNode[], tag: string): XmlNode[] {
  const found: XmlNode[] = [];
  const visit = (list: XmlNode[]) => {
    for (const node of list) {
      if (node.tag === tag) found.push(node);
      else visit(node.children);
    }
  };
  visit(nodes);
  return found;
}

export function findFirst(nodes: XmlNode[], tag: string): XmlNode | undefined {
  for (const node of nodes) {
    if (node.tag === tag) return node;
    const nested = findFirst(node.children, tag);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Concatenates text of `textTag` nodes (the node itself included); `breakTags`
 * become newlines, `tabTags` tabs, and `skipTags` subtrees (e.g. paragraph
 * properties holding tab-stop definitions) are ignored.
 */
export function collectText(
  node: XmlNode,
  textTag: string,
  breakTags: string[] = [],
  tabTags: string[] = [],
  skipTags: string[] = [],
): string {
  let output = "";
  const visit = (current: XmlNode) => {
    if (skipTags.includes(current.tag)) return;
    if (current.tag === textTag) {
      output += current.children.map((child) => child.text ?? "").join("");
      return;
    }
    if (breakTags.includes(current.tag)) output += "\n";
    if (tabTags.includes(current.tag)) output += "\t";
    current.children.forEach(visit);
  };
  visit(node);
  return output;
}

export type ZipEntries = Record<string, Uint8Array>;

export function unzip(bytes: Uint8Array): ZipEntries {
  return unzipSync(bytes);
}

export function zipText(entries: ZipEntries, name: string): string | null {
  const entry = entries[name];
  return entry ? strFromU8(entry) : null;
}

/** Parses a `.rels` part into id → part path (targets resolved against `baseDir`). */
export function readRelationships(entries: ZipEntries, relsPath: string, baseDir: string): Map<string, string> {
  const relationships = new Map<string, string>();
  const xml = zipText(entries, relsPath);
  if (!xml) return relationships;
  for (const rel of findAll(parseXml(xml), "Relationship")) {
    if (attribute(rel, "TargetMode") === "External") continue;
    const id = attribute(rel, "Id");
    const target = attribute(rel, "Target");
    if (id && target) relationships.set(id, resolvePartPath(baseDir, target));
  }
  return relationships;
}

/** Path of the .rels part that belongs to a given part ("ppt/slides/slide1.xml" → "ppt/slides/_rels/slide1.xml.rels"). */
export function relsPathFor(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  return `${partPath.slice(0, slash)}/_rels/${partPath.slice(slash + 1)}.rels`;
}

export function partDir(partPath: string): string {
  return partPath.slice(0, partPath.lastIndexOf("/"));
}

export function resolvePartPath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const resolved: string[] = [];
  for (const part of `${baseDir}/${target}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

export function cleanText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
