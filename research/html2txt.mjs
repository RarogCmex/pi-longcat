// Convert a VitePress SSR HTML page to readable text for offline reading.
// Usage: node research/html2txt.mjs research/doc-api-docs.html > research/doc-api-docs.txt
import { readFileSync } from "node:fs";

const src = readFileSync(process.argv[2], "utf8");
// Drop head, scripts, styles, nav/sidebar chrome.
let html = src
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<head[\s\S]*?<\/head>/gi, "")
  .replace(/<svg[\s\S]*?<\/svg>/gi, "")
  .replace(/<(nav|aside)[\s\S]*?<\/\1>/gi, "");
// Block-level tags become newlines; keep table cells on one line separated by " | ".
html = html
  .replace(/<\/(p|div|li|h[1-6]|tr|pre|blockquote|section)>/gi, "\n")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/t[dh]>/gi, " | ")
  .replace(/<[^>]+>/g, "");
const text = html
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, "&")
  .replace(/&nbsp;/g, " ")
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();
process.stdout.write(text + "\n");
