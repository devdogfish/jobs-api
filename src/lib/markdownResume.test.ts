import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidMarkdownResume, renderMarkdownResume, retainedTrackingHeader } from "./markdownResume.js";

const fallbackFonts = { regular: "", bold: "", italic: "", boldItalic: "" };
const source = "https://example.com/profile";
const tracked = "https://example.net/visit";
const markdown = `# Sample Candidate

City | [Profile](${source}) | [Email](mailto:sample@example.com)

## Summary

**Role** with *relevant* experience and a literal |.

## Experience

- Led the project.
  - Published the results.
`;

test("renders only the supplied résumé and rewrites exact link destinations", async () => {
  const { pdf, retainedTracking } = await renderMarkdownResume({
    markdown,
    trackingLinks: { [source]: tracked, [source + "/other"]: "https://example.net/other" },
  }, false, fallbackFonts);

  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.match(pdf.toString("latin1"), /\/URI \(https:\/\/example\.net\/visit\)/);
  assert.match(pdf.toString("latin1"), /\/URI \(mailto:sample@example\.com\)/);
  assert.ok(!pdf.includes(source));
  assert.deepEqual(retainedTracking, [source]);
});

test("recognizes an already-tracked URL and serializes tracking keys as ASCII", async () => {
  const internationalSource = source + "/é";
  const result = await renderMarkdownResume({
    markdown: markdown.replace(source, tracked),
    trackingLinks: { [internationalSource]: tracked },
  }, false, fallbackFonts);

  const header = retainedTrackingHeader(result.retainedTracking);
  assert.match(header, /^[\x20-\x7e]+$/);
  assert.deepEqual(JSON.parse(header), [internationalSource]);
});

test("rejects unsupported active content and invalid link destinations", async () => {
  for (const input of [
    { markdown: markdown.replace(source, "file:///etc/passwd") },
    { markdown: markdown + "\n![remote](https://example.com/image.png)\n" },
    { markdown, trackingLinks: { [source]: "http://example.net/visit" } },
  ]) {
    await assert.rejects(renderMarkdownResume(input, false, fallbackFonts), InvalidMarkdownResume);
  }
});
