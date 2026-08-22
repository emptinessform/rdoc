#!/bin/sh
# Fetch the S1 test corpus: real .docx fixtures from bokuweb/docx-rs (MIT).
# Files are not committed here — run this script, then `cargo run --bin corpus`.
set -e
cd "$(dirname "$0")"
for n in footnotes header_footer hello_libre_office image image_inline_and_anchor \
         font comment bookmark highlight_and_underline history_libre_office \
         nested_table numbering tab_and_break table_libre_office; do
  url=$(gh api "repos/bokuweb/docx-rs/contents/fixtures/$n" \
        -q '.[] | select(.name | endswith(".docx")) | .download_url' | head -1)
  [ -n "$url" ] && curl -sL "$url" -o "$n.docx" && echo "fetched $n.docx"
done
