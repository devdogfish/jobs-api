import { fromMarkdown } from "mdast-util-from-markdown";
import type { PhrasingContent, RootContent } from "mdast";
import PDFDocument from "pdfkit";
import { drawResumeSectionRule, registerResumeFonts, type ResumeFonts } from "./utils.js";

export const markdownResumeRenderer = "jobs-api-markdown-v1";
const maxMarkdownLength = 48_000;
const maxTrackingHeaderBytes = 6_000;
const segmenter = new Intl.Segmenter();

export class InvalidMarkdownResume extends Error {}

export function retainedTrackingHeader(keys: string[]) {
  return JSON.stringify(keys).replace(/[^\x00-\x7f]/g, character =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function validLink(target: string, protocol?: string) {
  if (target.length > 2_048 || /[\s\u0000-\u001f\u007f]/.test(target)) return false;

  let url: URL;
  try { url = new URL(target); }
  catch { return false; }
  if (protocol && url.protocol !== protocol) return false;
  switch (url.protocol) {
    case "https:":
      return Boolean(url.hostname && !url.username && !url.password);
    case "mailto:":
      return /^[\w.+-]+@[\w.-]+$/.test(url.pathname) && !url.search && !url.hash;
    case "tel:":
      return /^\+?[0-9().-]+$/.test(url.pathname) && !url.search && !url.hash;
    default:
      return false;
  }
}

type RunStyle = { bold?: boolean; italic?: boolean; link?: string; icon?: boolean; small?: boolean };

// Links render as blue text on a pale pill. Body links end with an external-link icon inside the pill.
const linkColor = "#0b4fd6";
const linkHighlight = "#e6eefc";
const iconSize = 7;
const iconGap = 2.4;
const iconPadding = 1.8;
// Links inside larger heading lines use body size, centered on the heading's text.
const bodySize = 10;
type Run = RunStyle & { text: string };
type Row = {
  runs: Run[];
  kind: "name" | "contact" | "section" | "subheading" | "paragraph" | "rule";
  indent?: number;
  bullet?: string;
  compact?: boolean;
  experienceStart?: "first" | "next";
  /** Line within an experience entry heading: 0 company, 1 title, 2 description. */
  entryLine?: number;
};

function makeRows(markdown: string, trackingLinks: Map<string, string>) {
  const retainedTracking = new Set<string>();
  const keysByReplacement = new Map<string, string[]>();
  for (const [key, replacement] of trackingLinks) {
    const keys = keysByReplacement.get(replacement);
    if (keys) keys.push(key);
    else keysByReplacement.set(replacement, [key]);
  }
  const tree = fromMarkdown(markdown);
  if (
    tree.children[0]?.type !== "heading" ||
    tree.children[0].depth !== 1 ||
    tree.children[1]?.type !== "paragraph"
  ) throw new InvalidMarkdownResume();

  function inline(nodes: PhrasingContent[], style: RunStyle = {}, depth = 0): Run[] {
    if (depth > 24) throw new InvalidMarkdownResume();

    return nodes.flatMap((node): Run[] => {
      switch (node.type) {
        case "text":
        case "inlineCode":
          return [{ ...style, text: node.value }];
        case "break":
          return [{ ...style, text: "\n" }];
        case "strong":
          return inline(node.children, { ...style, bold: true }, depth + 1);
        case "emphasis":
          return inline(node.children, { ...style, italic: true }, depth + 1);
        case "link": {
          if (node.url.startsWith("#")) return inline(node.children, style, depth + 1);
          if (!validLink(node.url)) throw new InvalidMarkdownResume();
          const replacement = trackingLinks.get(node.url);
          if (replacement) retainedTracking.add(node.url);
          for (const key of keysByReplacement.get(replacement ?? node.url) ?? []) {
            retainedTracking.add(key);
          }
          const linked = inline(node.children, { ...style, link: replacement ?? node.url }, depth + 1);
          return [...linked, { ...style, link: replacement ?? node.url, icon: true, text: "" }];
        }
        default:
          throw new InvalidMarkdownResume();
      }
    });
  }

  const rows: Row[] = [];
  function block(node: RootContent, indent = 0, bullet?: string) {
    if (indent > 180) throw new InvalidMarkdownResume();

    switch (node.type) {
      case "heading":
        rows.push({
          kind: node === tree.children[0] ? "name" : node.depth === 2 ? "section" : "subheading",
          runs: inline(node.children, { bold: true }),
          indent,
          bullet,
        });
        break;
      case "paragraph":
        rows.push({
          kind: node === tree.children[1] ? "contact" : "paragraph",
          runs: inline(node.children).filter(run => node !== tree.children[1] || !run.icon),
          indent,
          bullet,
        });
        break;
      case "list":
        node.children.forEach((item, index) => {
          const label = node.ordered ? `${(node.start ?? 1) + index}.` : "•";
          if (!item.children.length || item.children[0].type === "list") {
            rows.push({ kind: "paragraph", runs: [], bullet: label, indent });
          }
          item.children.forEach((child, childIndex) => {
            if (childIndex === 0 && child.type !== "list") block(child, indent, label);
            else block(child, indent + (node.ordered ? 28 : 20));
          });
        });
        break;
      case "blockquote":
        node.children.forEach(child => block(child, indent + 20));
        break;
      case "code":
        rows.push({ kind: "paragraph", runs: [{ text: node.value }], indent, bullet });
        break;
      case "thematicBreak":
        rows.push({ kind: "rule", runs: [], indent, bullet });
        break;
      default:
        throw new InvalidMarkdownResume();
    }
  }
  let inExperience = false;
  let hasExperienceEntry = false;
  let entryLine = -1;
  for (const node of tree.children) {
    if (node.type === "heading" && node.depth === 2) {
      inExperience = /\bexperience\b/i.test(inline(node.children).map(run => run.text).join(""));
      hasExperienceEntry = false;
    }
    const entry = inExperience && (
      (node.type === "paragraph" && node.children[0]?.type === "strong") ||
      (node.type === "heading" && node.depth === 3)
    );
    const firstRow = rows.length;
    block(node);
    if (entry) {
      rows[firstRow].experienceStart = hasExperienceEntry ? "next" : "first";
      rows[firstRow].entryLine = entryLine = 0;
      hasExperienceEntry = true;
    } else if (inExperience && node.type === "paragraph" && entryLine >= 0 && entryLine < 2) {
      rows[firstRow].entryLine = ++entryLine;
    } else {
      entryLine = -1;
    }
    if (hasExperienceEntry) {
      for (let index = firstRow; index < rows.length; index++) rows[index].compact = true;
    }
  }
  for (const row of rows) {
    if (row.entryLine === 0) row.runs = row.runs.map(run => run.link ? { ...run, small: true } : run);
  }
  return { rows, retainedTracking: [...retainedTracking] };
}

function parseRequest(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InvalidMarkdownResume();
  const { markdown, trackingLinks } = input as Record<string, unknown>;
  if (
    typeof markdown !== "string" ||
    !markdown.trim() ||
    markdown.length > maxMarkdownLength ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|\{\{|\}\}/.test(markdown)
  ) throw new InvalidMarkdownResume();

  if (trackingLinks === undefined) return makeRows(markdown, new Map());
  if (!trackingLinks || typeof trackingLinks !== "object" || Array.isArray(trackingLinks)) {
    throw new InvalidMarkdownResume();
  }
  const mappings = Object.entries(trackingLinks);
  if (
    mappings.length > 100 ||
    retainedTrackingHeader(Object.keys(trackingLinks)).length > maxTrackingHeaderBytes
  ) throw new InvalidMarkdownResume();

  const validated = new Map<string, string>();
  for (const [source, dest] of mappings) {
    if (!validLink(source, "https:") || typeof dest !== "string" || !validLink(dest, "https:")) {
      throw new InvalidMarkdownResume();
    }
    validated.set(source, dest);
  }
  return makeRows(markdown, validated);
}

type PlacedRun = Run & { width: number };

function wrapRuns(doc: PDFKit.PDFDocument, fonts: ResumeFonts, runs: Run[], width: number) {
  const lines: PlacedRun[][] = [];
  let line: PlacedRun[] = [];
  let lineWidth = 0;
  let spacing = "";
  const rowSize = (doc as unknown as { _fontSize: number })._fontSize;

  function flush() {
    lines.push(line);
    line = [];
    lineWidth = 0;
    spacing = "";
  }

  function place(run: Run, text: string, measured: number) {
    const previous = line.at(-1);
    if (previous && previous.bold === run.bold && previous.italic === run.italic && previous.link === run.link) {
      previous.text += text;
      previous.width += measured;
    } else {
      line.push({ ...run, text, width: measured });
    }
    lineWidth += measured;
  }

  for (const run of runs) {
    doc.font(fonts[fontOf(run)]).fontSize(run.small ? bodySize : rowSize);
    if (run.icon) {
      const iconWidth = iconSize + iconGap + iconPadding;
      if (line.length && lineWidth + iconWidth > width) flush();
      line.push({ ...run, width: iconWidth });
      lineWidth += iconWidth;
      spacing = "";
      continue;
    }
    for (const part of run.text.match(/\n|[^\S\n]+|\S+/gu) ?? []) {
      if (part === "\n") {
        flush();
        continue;
      }
      if (!part.trim()) {
        spacing += part;
        continue;
      }
      let text = spacing + part;
      let measured = doc.widthOfString(text);
      if (line.length && lineWidth + measured > width) {
        flush();
        text = part;
        measured = doc.widthOfString(text);
      }
      spacing = "";
      if (measured <= width) {
        place(run, text, measured);
        continue;
      }
      for (const { segment } of segmenter.segment(text)) {
        const segmentWidth = doc.widthOfString(segment);
        if (line.length && lineWidth + segmentWidth > width) flush();
        place(run, segment, segmentWidth);
      }
    }
  }
  flush();
  return lines;
}

function fontOf(run: Run): keyof ResumeFonts {
  if (run.bold) return run.italic ? "boldItalic" : "bold";
  return run.italic ? "italic" : "regular";
}

function paintRow(doc: PDFKit.PDFDocument, fonts: ResumeFonts, row: Row) {
  const { left, right, bottom } = doc.page.margins;
  const pageBottom = doc.page.height - bottom;
  const bodyWidth = doc.page.width - left - right;

  if (row.kind === "rule") {
    if (doc.y + 12 > pageBottom) doc.addPage();
    drawResumeSectionRule(doc, left - 2, doc.page.width - right + 1);
    return;
  }

  const heading = row.kind === "section" || row.kind === "subheading";
  const fontSize = row.kind === "name" ? 20 : row.kind === "section" ? 12
    : row.entryLine === 0 ? 11.5 : row.entryLine === 2 ? 9 : 10;
  const bulletWidth = row.bullet === undefined ? 0 : row.bullet === "•" ? 20 : 28;
  const lineLeft = left + (row.indent ?? 0) + bulletWidth;
  const available = doc.page.width - right - lineLeft;
  const centered = row.kind === "name" || row.kind === "contact";

  doc.font(fonts.regular).fontSize(fontSize);
  const lineHeight = doc.currentLineHeight(true);
  const runs = row.kind === "section"
    ? row.runs.map(run => ({ ...run, text: run.text.toUpperCase() }))
    : row.runs;
  const lines = wrapRuns(doc, fonts, runs, available);
  const gap = row.experienceStart === "next" ? lineHeight
    : row.kind === "section" ? lineHeight * 0.6
    : heading && !row.compact ? lineHeight * 0.3
    : row.entryLine === 1 || row.entryLine === 2 ? lineHeight * 0.15
    : row.bullet !== undefined ? lineHeight * 0.25 : 0;
  const nextLine = row.experienceStart ? lineHeight * 3.5 : heading ? lineHeight * 1.7 : 0;
  if (doc.y + gap + Math.min(lines.length, 2) * lineHeight + nextLine > pageBottom) {
    doc.addPage();
  } else {
    doc.y += gap;
  }
  if (row.entryLine === 2) doc.fillColor("#555555");
  for (const [index, line] of lines.entries()) {
    if (doc.y + lineHeight > pageBottom) doc.addPage();
    const y = doc.y;
    let x = centered
      ? left + (bodyWidth - line.reduce((sum, run) => sum + run.width, 0)) / 2
      : lineLeft;

    if (index === 0 && row.bullet !== undefined) {
      doc.font(fonts.regular).text(row.bullet, lineLeft - bulletWidth, y, { lineBreak: false });
    }
    const ascentAt = (size: number) =>
      (doc as unknown as { _font: { ascender: number } })._font.ascender / 1000 * size;
    doc.font(fonts.regular).fontSize(fontSize);
    const rowBaseline = y + ascentAt(fontSize);
    const sizeOf = (run: PlacedRun) => run.small ? bodySize : fontSize;
    const baselineOf = (run: PlacedRun) =>
      run.small ? rowBaseline - 0.35 * (fontSize - bodySize) : rowBaseline;

    let cursor = x;
    let span: { link: string; start: number; end: number; run: PlacedRun } | undefined;
    const spans: Array<{ start: number; end: number; run: PlacedRun }> = [];
    for (const run of line) {
      if (!run.link) {
        if (span) spans.push(span);
        span = undefined;
        cursor += run.width;
        continue;
      }
      let start = cursor;
      let end = cursor + run.width;
      if (!run.icon) {
        doc.font(fonts[fontOf(run)]).fontSize(sizeOf(run));
        start += doc.widthOfString(run.text.slice(0, run.text.length - run.text.trimStart().length));
        end -= doc.widthOfString(run.text.slice(run.text.trimEnd().length));
      }
      if (span && span.link === run.link) span.end = end;
      else {
        if (span) spans.push(span);
        span = { link: run.link, start, end, run };
      }
      cursor += run.width;
    }
    if (span) spans.push(span);
    for (const { start, end, run } of spans) {
      const size = sizeOf(run);
      doc.save().fillColor(linkHighlight)
        .roundedRect(start - 1.6, baselineOf(run) - size * 0.86, end - start + 3.2, size * 1.14, 2.2).fill().restore();
    }

    for (const run of line) {
      const base = row.entryLine === 2 ? "#555555" : "black";
      const size = sizeOf(run);
      const baseline = baselineOf(run);
      doc.font(fonts[fontOf(run)]).fontSize(size);
      if (run.icon) {
        const k = iconSize / 24;
        const left = x + iconGap;
        const top = baseline - iconSize * 0.92;
        doc.save().translate(left, top).scale(k).lineWidth(2.6).lineCap("round").lineJoin("round").strokeColor(linkColor)
          .path("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6").stroke()
          .path("M15 3h6v6").stroke()
          .path("M10 14L21 3").stroke().restore();
        doc.link(left, top, iconSize, iconSize, run.link!);
        x += run.width;
        continue;
      }
      const textY = baseline - ascentAt(size);
      doc.fillColor(run.link ? linkColor : base);
      doc.text(run.text, x, textY, { lineBreak: false });
      if (run.link && run.width > 0) doc.link(x, textY, run.width, size * 1.2, run.link);
      doc.fillColor(base);
      x += run.width;
    }
    doc.font(fonts.regular).fontSize(fontSize);
    doc.y = y + lineHeight;
  }
  if (row.entryLine === 2) doc.fillColor("black");

  if (row.kind === "section") {
    drawResumeSectionRule(doc.font(fonts.bold), left - 2, doc.page.width - right + 1);
  } else if (row.kind === "contact" || (row.kind === "paragraph" && !row.bullet && !row.compact)) {
    doc.y += lineHeight * 0.4;
  }
}

export async function renderMarkdownResume(
  input: unknown,
  hasCambria: boolean,
  fontPaths: ResumeFonts,
) {
  const { rows, retainedTracking } = parseRequest(input);
  const pdf = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 25 });
    const chunks: Uint8Array[] = [];
    doc.on("data", chunk => chunks.push(Uint8Array.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const fonts = registerResumeFonts(doc, hasCambria, fontPaths);
    rows.forEach(row => paintRow(doc, fonts, row));
    doc.end();
  });
  return { pdf, retainedTracking };
}
