#!/usr/bin/env python3
"""Convert a VitePress SSR HTML page to readable text for offline reading.
Usage: python3 html2txt.py doc-api-docs.html > doc-api-docs.txt"""
import re, sys, html as H
src = open(sys.argv[1], encoding="utf8", errors="replace").read()
for pat in (r"<script[\s\S]*?</script>", r"<style[\s\S]*?</style>", r"<head[\s\S]*?</head>",
            r"<svg[\s\S]*?</svg>", r"<nav[\s\S]*?</nav>", r"<aside[\s\S]*?</aside>"):
    src = re.sub(pat, "", src, flags=re.I)
src = re.sub(r"</(p|div|li|h[1-6]|tr|pre|blockquote|section)>", "\n", src, flags=re.I)
src = re.sub(r"<br\s*/?>", "\n", src, flags=re.I)
src = re.sub(r"</t[dh]>", " | ", src, flags=re.I)
src = re.sub(r"<[^>]+>", "", src)
src = H.unescape(src)
src = re.sub(r"[ \t]+\n", "\n", src)
src = re.sub(r"\n{3,}", "\n\n", src).strip()
print(src)
