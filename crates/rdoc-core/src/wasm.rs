//! Wasm bindings: DOCX -> SVG entirely in the browser, with a stateful
//! document, editing operations, and snapshot-based undo/redo.
//!
//! System font discovery does not exist on wasm32, so the caller supplies
//! font bytes (fetched by the page) via `add_font`. rdocx's resolution order
//! then is: caller fonts -> fonts embedded in the DOCX -> bundled
//! metric-compatible fonts.

use wasm_bindgen::prelude::*;

use crate::{
    HitRun, RenderCache, body_order_of, covered_note_refs, delete_char_at, delete_range_across,
    delete_range_at, insert_text_at, parse_doc_path, parse_edit_path, remove_notes, render_delta,
    text_at, toggle_at,
};

const UNDO_CAP: usize = 100;

/// Ordinal among body tables for the table at `body_index`, or None
/// when that body item is not a table (Document::table/table_mut count
/// tables, while our paths carry body content indices).
fn table_ordinal(doc: &rdocx::Document, body_index: usize) -> Option<usize> {
    let mut ordinal = 0usize;
    for (i, item) in doc.body_items().enumerate() {
        if i == body_index {
            return matches!(item, rdocx::BodyItemRef::Table(_)).then_some(ordinal);
        }
        if matches!(item, rdocx::BodyItemRef::Table(_)) {
            ordinal += 1;
        }
    }
    None
}

#[wasm_bindgen]
pub struct SvgConverter {
    fonts: Vec<(String, Vec<u8>)>,
    /// Requested-name -> target-family font aliases (no bytes). Lets one
    /// open font serve many document-facing Korean family names without
    /// duplicating its data on every layout.
    aliases: Vec<(String, String)>,
    doc: Option<rdocx::Document>,
    /// Snapshot-based history: serialized docx bytes. Simple and correct;
    /// a command-pattern history is the optimization path if snapshots get
    /// heavy on large documents.
    undo: Vec<Vec<u8>>,
    redo: Vec<Vec<u8>>,
    /// While an IME composition is in flight, edits skip checkpointing so
    /// the whole composition is one undo entry (pushed by
    /// `begin_composition`).
    composing: bool,
    /// Id created by the most recent successful `insert_footnote`.
    last_note_id: Option<i32>,
    /// Render the Tracked revision projection instead of the final view.
    tracked_view: bool,
    cache: RenderCache,
}

#[derive(serde::Serialize)]
struct RenderOut {
    total: usize,
    /// 0-based indices of pages whose content changed; the page pulls each
    /// SVG on demand via `page_svg`, visible pages first.
    changed: Vec<usize>,
    hits: Vec<(usize, Vec<HitRun>)>,
    can_undo: bool,
    can_redo: bool,
}

#[wasm_bindgen]
impl SvgConverter {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            fonts: Vec::new(),
            doc: None,
            aliases: Vec::new(),
            undo: Vec::new(),
            redo: Vec::new(),
            composing: false,
            last_note_id: None,
            tracked_view: false,
            cache: RenderCache::default(),
        }
    }

    /// Register a font available to layout, e.g. one fetched by the page.
    pub fn add_font(&mut self, family: &str, data: &[u8]) {
        self.fonts.push((family.to_owned(), data.to_vec()));
    }

    /// Point a document-facing family name at a registered font's family
    /// (e.g. "\u{bc14}\u{d0d5}" -> "NanumMyeongjo") without duplicating font bytes.
    pub fn add_font_alias(&mut self, requested: &str, family: &str) {
        self.aliases.push((requested.to_owned(), family.to_owned()));
    }

    /// Load a .docx as the current document.
    pub fn load_docx(&mut self, docx: &[u8]) -> Result<(), JsValue> {
        self.doc = Some(rdocx::Document::from_bytes(docx).map_err(err)?);
        self.undo.clear();
        self.redo.clear();
        self.composing = false;
        self.cache.clear();
        Ok(())
    }

    /// Load the built-in demo document (built in the browser).
    pub fn load_demo(&mut self) {
        self.doc = Some(crate::build_demo_doc());
        self.undo.clear();
        self.redo.clear();
        self.composing = false;
        self.cache.clear();
    }

    /// Lay out and render, reporting only pages/hit maps that changed since
    /// the previous call. JSON: {"total": N, "pages": [[i, svg], ...],
    /// "hits": [[i, [run, ...]], ...], "can_undo": .., "can_redo": ..}.
    pub fn render(&mut self) -> Result<String, JsValue> {
        let doc = self.doc.as_ref().ok_or_else(|| err("no document loaded"))?;
        let fonts: Vec<(&str, &[u8])> = self
            .fonts
            .iter()
            .map(|(family, data)| (family.as_str(), data.as_slice()))
            .collect();
        let aliases: Vec<(&str, &str)> = self
            .aliases
            .iter()
            .map(|(requested, target)| (requested.as_str(), target.as_str()))
            .collect();
        let options = rdocx::RenderOptions {
            revision_view: if self.tracked_view {
                rdocx::RevisionView::Tracked
            } else {
                rdocx::RevisionView::Accepted
            },
        };
        let layout = doc
            .layout_with_fonts_aliases_options_and_bundled_fallback(&fonts, &aliases, options)
            .map_err(err)?;
        let delta = render_delta(&layout, &mut self.cache);
        serde_json::to_string(&RenderOut {
            total: delta.total_pages,
            changed: delta.changed_pages,
            hits: delta.hits,
            can_undo: !self.undo.is_empty(),
            can_redo: !self.redo.is_empty(),
        })
        .map_err(err)
    }

    /// SVG for one page of the current document (0-based). The layout is
    /// cached, so pulling pages one by one after `render` costs only the
    /// SVG string generation for that page.
    pub fn page_svg(&mut self, index: usize) -> Result<String, JsValue> {
        let doc = self.doc.as_ref().ok_or_else(|| err("no document loaded"))?;
        let fonts: Vec<(&str, &[u8])> = self
            .fonts
            .iter()
            .map(|(family, data)| (family.as_str(), data.as_slice()))
            .collect();
        let aliases: Vec<(&str, &str)> = self
            .aliases
            .iter()
            .map(|(requested, target)| (requested.as_str(), target.as_str()))
            .collect();
        let options = rdocx::RenderOptions {
            revision_view: if self.tracked_view {
                rdocx::RevisionView::Tracked
            } else {
                rdocx::RevisionView::Accepted
            },
        };
        let layout = doc
            .layout_with_fonts_aliases_options_and_bundled_fallback(&fonts, &aliases, options)
            .map_err(err)?;
        crate::render_page_svg(&layout, index).ok_or_else(|| err("page out of range"))
    }

    fn checkpoint(&mut self) -> Result<(), JsValue> {
        let doc = self.doc.as_mut().ok_or_else(|| err("no document loaded"))?;
        let bytes = doc.to_bytes().map_err(err)?;
        self.undo.push(bytes);
        if self.undo.len() > UNDO_CAP {
            self.undo.remove(0);
        }
        self.redo.clear();
        Ok(())
    }

    fn mutate(
        &mut self,
        op: impl FnOnce(&mut rdocx::Document) -> bool,
        what: &str,
    ) -> Result<String, JsValue> {
        let checkpointed = !self.composing;
        if checkpointed {
            self.checkpoint()?;
        }
        let doc = self.doc.as_mut().unwrap();
        if !op(doc) {
            // A multi-step op can fail midway; restore the checkpoint so a
            // refusal never leaves a partial mutation behind, then drop it
            // so undo stays truthful. (Mid-composition ops are single-step
            // and cannot partially fail, so there is nothing to restore.)
            if checkpointed
                && let Some(prev) = self.undo.pop()
                && let Ok(restored) = rdocx::Document::from_bytes(&prev)
            {
                self.replace_doc(restored);
            }
            return Err(err(format!("{what} failed at that position")));
        }
        self.render()
    }

    /// Open an IME composition: one checkpoint now, none for the preedit
    /// updates that follow, so undo removes the composed text as a unit.
    pub fn begin_composition(&mut self) -> Result<(), JsValue> {
        if self.composing {
            return Ok(());
        }
        self.checkpoint()?;
        self.composing = true;
        Ok(())
    }

    /// Close the composition opened by `begin_composition`. A cancelled
    /// composition (empty final text, nothing else edited) leaves the
    /// document identical to its checkpoint, which is then dropped so undo
    /// does not step through a no-op.
    pub fn end_composition(&mut self) {
        if !self.composing {
            return;
        }
        self.composing = false;
        if let (Some(doc), Some(prev)) = (self.doc.as_mut(), self.undo.last())
            && doc.to_bytes().ok().as_deref() == Some(prev.as_slice())
        {
            self.undo.pop();
        }
    }

    /// Insert text at (source path, char offset), then re-render. Paths are
    /// the Document-story hit paths ("d/12" body, "d/12.0.1.0" table cell).
    pub fn insert(&mut self, path: &str, offset: usize, text: &str) -> Result<String, JsValue> {
        let Some(at) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        let text = text.to_owned();
        self.mutate(move |d| insert_text_at(d, &at, offset, &text), "insert")
    }

    /// Delete the character before (source path, char offset).
    pub fn delete(&mut self, path: &str, offset: usize) -> Result<String, JsValue> {
        let Some(at) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        self.mutate(move |d| delete_char_at(d, &at, offset), "delete")
    }

    /// Delete an arbitrary range. Within one paragraph (any story) any range
    /// works; across paragraphs both ends must be sibling paragraphs of one
    /// container (body run, one table cell, one header/footer, one note).
    /// Scattered selections (across cells) go through `delete_ranges`.
    pub fn delete_selection(
        &mut self,
        pa: &str,
        oa: usize,
        pb: &str,
        ob: usize,
    ) -> Result<String, JsValue> {
        if pa == pb {
            let Some(at) = parse_edit_path(pa) else {
                return Err(err("not an editable location"));
            };
            let (lo, hi) = (oa.min(ob), oa.max(ob));
            return self.mutate(
                move |d| {
                    let doomed = covered_note_refs(d, &at, Some(lo), Some(hi));
                    remove_notes(d, &doomed) && delete_range_at(d, &at, lo, hi)
                },
                "delete range",
            );
        }
        let Some((a, oa, b, ob)) = Self::sibling_ends(pa, oa, pb, ob) else {
            return Err(err("selection ends are not sibling paragraphs"));
        };
        self.mutate(
            move |d| delete_range_across(d, &a, oa, &b, ob),
            "delete range",
        )
    }

    /// Replace a selection with text as one history entry (typing over a
    /// selection). Same reach as `delete_selection`; the text lands where
    /// the selection started.
    pub fn replace_selection(
        &mut self,
        pa: &str,
        oa: usize,
        pb: &str,
        ob: usize,
        text: &str,
    ) -> Result<String, JsValue> {
        let text = text.to_owned();
        if pa == pb {
            let Some(at) = parse_edit_path(pa) else {
                return Err(err("not an editable location"));
            };
            let (lo, hi) = (oa.min(ob), oa.max(ob));
            return self.mutate(
                move |d| {
                    let doomed = covered_note_refs(d, &at, Some(lo), Some(hi));
                    remove_notes(d, &doomed)
                        && delete_range_at(d, &at, lo, hi)
                        && (text.is_empty() || insert_text_at(d, &at, lo, &text))
                },
                "replace selection",
            );
        }
        let Some((a, oa, b, ob)) = Self::sibling_ends(pa, oa, pb, ob) else {
            return Err(err("selection ends are not sibling paragraphs"));
        };
        self.mutate(
            move |d| {
                delete_range_across(d, &a, oa, &b, ob)
                    && (text.is_empty() || insert_text_at(d, &a, oa, &text))
            },
            "replace selection",
        )
    }

    /// Parse two selection ends into sibling paragraphs of one container,
    /// ordered by their sibling index.
    fn sibling_ends(
        pa: &str,
        oa: usize,
        pb: &str,
        ob: usize,
    ) -> Option<(crate::EditPath, usize, crate::EditPath, usize)> {
        let (a, b) = (parse_edit_path(pa)?, parse_edit_path(pb)?);
        let (ka, ia) = crate::sibling_locus(&a);
        let (kb, ib) = crate::sibling_locus(&b);
        if ka != kb {
            return None;
        }
        Some(if ib < ia { (b, ob, a, oa) } else { (a, oa, b, ob) })
    }

    /// Delete several per-paragraph ranges as one history entry — the
    /// scattered shape of a selection spanning table cells. Word semantics
    /// approximated: text goes, cell/paragraph structure stays. Input is a
    /// JSON array of `{path, start, end}`.
    pub fn delete_ranges(&mut self, json: &str) -> Result<String, JsValue> {
        let ranges = Self::parse_ranges(json)?;
        self.mutate(
            move |d| {
                Self::remove_ranges_notes(d, &ranges)
                    && ranges.iter().all(|(at, s, e)| delete_range_at(d, at, *s, *e))
            },
            "delete ranges",
        )
    }

    /// Remove the notes whose reference markers fall strictly inside any of
    /// the given ranges (shared by the scattered delete/replace ops).
    fn remove_ranges_notes(
        d: &mut rdocx::Document,
        ranges: &[(crate::EditPath, usize, usize)],
    ) -> bool {
        let mut doomed: Vec<(bool, i32)> = Vec::new();
        for (at, s, e) in ranges {
            for x in covered_note_refs(d, at, Some(*s), Some(*e)) {
                if !doomed.contains(&x) {
                    doomed.push(x);
                }
            }
        }
        remove_notes(d, &doomed)
    }

    /// `delete_ranges` plus one insertion at the first range's start (typing
    /// over a scattered selection). One history entry.
    pub fn replace_ranges(&mut self, json: &str, text: &str) -> Result<String, JsValue> {
        let ranges = Self::parse_ranges(json)?;
        let text = text.to_owned();
        self.mutate(
            move |d| {
                Self::remove_ranges_notes(d, &ranges)
                    && ranges.iter().all(|(at, s, e)| delete_range_at(d, at, *s, *e))
                    && (text.is_empty() || {
                        let (at, s, _) = &ranges[0];
                        insert_text_at(d, at, *s, &text)
                    })
            },
            "replace ranges",
        )
    }

    /// Replace every given range with `text` as one history entry (replace
    /// all). Ranges arrive in document order and non-overlapping; they are
    /// applied in reverse so earlier offsets in the same paragraph survive.
    /// Notes whose markers fall inside a range are removed (Word behavior).
    pub fn replace_all(&mut self, json: &str, text: &str) -> Result<String, JsValue> {
        let ranges = Self::parse_ranges(json)?;
        let text = text.to_owned();
        self.mutate(
            move |d| {
                Self::remove_ranges_notes(d, &ranges)
                    && ranges.iter().rev().all(|(at, s, e)| {
                        delete_range_at(d, at, *s, *e)
                            && (text.is_empty() || insert_text_at(d, at, *s, &text))
                    })
            },
            "replace all",
        )
    }

    fn parse_ranges(json: &str) -> Result<Vec<(crate::EditPath, usize, usize)>, JsValue> {
        #[derive(serde::Deserialize)]
        struct RangeSpec {
            path: String,
            start: usize,
            end: usize,
        }
        let specs: Vec<RangeSpec> =
            serde_json::from_str(json).map_err(|e| err(&format!("bad ranges: {e}")))?;
        if specs.is_empty() {
            return Err(err("no ranges"));
        }
        specs
            .into_iter()
            .map(|r| {
                parse_edit_path(&r.path)
                    .map(|at| (at, r.start, r.end))
                    .ok_or_else(|| err("not an editable location"))
            })
            .collect()
    }

    /// Replace [start, end) in one paragraph with text (IME composition).
    pub fn replace_range(
        &mut self,
        path: &str,
        start: usize,
        end: usize,
        text: &str,
    ) -> Result<String, JsValue> {
        let Some(at) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        let text = text.to_owned();
        self.mutate(
            move |d| {
                delete_range_at(d, &at, start, end)
                    && (text.is_empty() || insert_text_at(d, &at, start, &text))
            },
            "replace",
        )
    }

    /// Split the paragraph at any editable hit path at a char offset
    /// (Enter).
    pub fn split(&mut self, path: &str, offset: usize) -> Result<String, JsValue> {
        let Some(at) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        self.mutate(move |d| crate::split_at(d, &at, offset), "split")
    }

    /// Insert an inline image at (Document-story path, char offset). Native
    /// size, scaled down to at most 300pt wide. One history entry.
    pub fn insert_image(
        &mut self,
        path: &str,
        offset: usize,
        data: &[u8],
        filename: &str,
    ) -> Result<String, JsValue> {
        let Some(crate::EditPath::Doc(children)) = parse_edit_path(path) else {
            return Err(err("images can only be inserted in the document body"));
        };
        let data = data.to_vec();
        let filename = filename.to_owned();
        self.mutate(
            move |d| d.insert_image_at(&children, offset, &data, &filename, 300.0),
            "insert image",
        )
    }

    /// Remove the k-th inline image in document order (matches the DOM's
    /// `<image>` order for inline body images). One history entry.
    pub fn remove_image(&mut self, index: usize) -> Result<String, JsValue> {
        self.mutate(move |d| d.remove_inline_image(index), "remove image")
    }

    /// Set the paragraph style for every path in the JSON string array, as
    /// one history entry.
    pub fn set_style_paths(&mut self, json: &str, style_id: &str) -> Result<String, JsValue> {
        let paths: Vec<String> =
            serde_json::from_str(json).map_err(|e| err(&format!("bad paths: {e}")))?;
        if paths.is_empty() {
            return Err(err("no paragraphs"));
        }
        let ats: Vec<crate::EditPath> = paths
            .iter()
            .map(|p| parse_edit_path(p).ok_or_else(|| err("not an editable location")))
            .collect::<Result<_, _>>()?;
        let style = style_id.to_owned();
        self.mutate(
            move |d| ats.iter().all(|at| crate::set_style_at(d, at, &style)),
            "style",
        )
    }

    /// Table structure ops keyed by the caret's cell path ("d/T.r.c.p",
    /// top-level tables only): 'r' inserts a row below, 'R' deletes the
    /// row, 'c' inserts a column to the right, 'C' deletes the column.
    pub fn table_op(&mut self, path: &str, op: char) -> Result<String, JsValue> {
        let Some(crate::EditPath::Doc(ch)) = parse_edit_path(path) else {
            return Err(err("not a table cell"));
        };
        if ch.len() != 4 {
            return Err(err("caret is not in a top-level table cell"));
        }
        let (t, r, c) = (ch[0], ch[1], ch[2]);
        self.mutate(
            move |d| match op {
                'r' => d.table_insert_row(t, r),
                'R' => d.table_delete_row(t, r),
                'c' => d.table_insert_column(t, c),
                'C' => d.table_delete_column(t, c),
                _ => false,
            },
            "table op",
        )
    }

    /// Switch between the final (Accepted) view and the Tracked view that
    /// renders both sides of modeled revisions with decorations. A view
    /// switch is not an edit: no history entry; returns a full render
    /// delta for the newly selected projection.
    pub fn set_revision_view(&mut self, tracked: bool) -> Result<String, JsValue> {
        self.tracked_view = tracked;
        self.cache.clear();
        self.render()
    }

    /// Whether the document carries any tracked revisions. Read-only.
    pub fn has_revisions(&mut self) -> Result<bool, JsValue> {
        let doc = self.doc.as_ref().ok_or_else(|| err("no document loaded"))?;
        Ok(!doc.revisions().is_empty())
    }

    /// Accept every tracked revision, as one history entry. Refuses when
    /// the document has none (so the menu action cannot record a no-op).
    pub fn accept_all_revisions(&mut self) -> Result<String, JsValue> {
        self.mutate(
            |d| d.accept_all().map(|n| n > 0).unwrap_or(false),
            "accept revisions",
        )
    }

    /// Reject every tracked revision, as one history entry.
    pub fn reject_all_revisions(&mut self) -> Result<String, JsValue> {
        self.mutate(
            |d| d.reject_all().map(|n| n > 0).unwrap_or(false),
            "reject revisions",
        )
    }

    /// Body-story statistics as JSON:
    /// `{"pages","paragraphs","words","chars","chars_no_space"}`.
    /// Pages come from the most recent render; text counts walk the body
    /// (tables included via their cell paragraphs). Read-only.
    pub fn doc_stats(&mut self) -> Result<String, JsValue> {
        let doc = self.doc.as_ref().ok_or_else(|| err("no document loaded"))?;
        let mut paragraphs = 0usize;
        let mut words = 0usize;
        let mut chars = 0usize;
        let mut chars_no_space = 0usize;
        let mut count_text = |text: &str| {
            words += text.split_whitespace().count();
            chars += text.chars().count();
            chars_no_space += text.chars().filter(|c| !c.is_whitespace()).count();
        };
        for item in doc.body_items() {
            match item {
                rdocx::BodyItemRef::Paragraph(p) => {
                    paragraphs += 1;
                    count_text(&p.text());
                }
                rdocx::BodyItemRef::Table(t) => {
                    for r in 0..t.row_count() {
                        for c in 0..t.column_count() {
                            let Some(cell) = t.cell(r, c) else { continue };
                            let text = cell.text();
                            paragraphs += text.lines().count().max(1);
                            count_text(&text);
                        }
                    }
                }
                _ => {}
            }
        }
        Ok(format!(
            r#"{{"pages":{},"paragraphs":{paragraphs},"words":{words},"chars":{chars},"chars_no_space":{chars_no_space}}}"#,
            self.cache.page_count(),
        ))
    }

    /// Add a comment over [start, end) of a TOP-LEVEL body paragraph
    /// ("d/N" — upstream anchors comments to body paragraphs), as one
    /// history entry. Returns the render delta.
    pub fn add_comment(
        &mut self,
        path: &str,
        start: usize,
        end: usize,
        author: &str,
        text: &str,
    ) -> Result<String, JsValue> {
        let Some(at) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        let crate::EditPath::Doc(ref ch) = at else {
            return Err(err("comments anchor to body paragraphs"));
        };
        if ch.len() != 1 {
            return Err(err("comments anchor to top-level body paragraphs"));
        }
        let body_index = ch[0];
        let author = author.to_owned();
        let text = text.to_owned();
        self.mutate(
            move |d| {
                let Some((rs, re)) = crate::run_range_at(d, &at, start, end) else {
                    return false;
                };
                d.add_comment(
                    rdocx::RunRange {
                        start: rdocx::RunPosition {
                            body_index,
                            run_index: rs,
                        },
                        end: rdocx::RunPosition {
                            body_index,
                            run_index: re,
                        },
                    },
                    &author,
                    None,
                    &text,
                )
                .is_ok()
            },
            "add comment",
        )
    }

    /// Remove a comment (its text and every anchor marker) by id, as one
    /// history entry.
    pub fn remove_comment(&mut self, id: i32) -> Result<String, JsValue> {
        self.mutate(
            move |d| d.remove_comment(id).unwrap_or(false),
            "remove comment",
        )
    }

    /// Mark a comment thread resolved / unresolved, as one history entry.
    pub fn resolve_comment(&mut self, id: i32, resolved: bool) -> Result<String, JsValue> {
        self.mutate(
            move |d| d.resolve_comment(id, resolved).unwrap_or(false),
            "resolve comment",
        )
    }

    /// The document's comments as JSON
    /// `[{"id","author","text","resolved"}]`. Read-only.
    pub fn comment_list(&mut self) -> Result<String, JsValue> {
        let doc = self.doc.as_ref().ok_or_else(|| err("no document loaded"))?;
        let items: Vec<serde_json::Value> = doc
            .comments()
            .iter()
            .map(|c| {
                serde_json::json!({
                    "id": c.id(),
                    "author": c.author(),
                    "text": c.text(),
                    "resolved": c.resolved(),
                })
            })
            .collect();
        serde_json::to_string(&items).map_err(err)
    }

    /// Comment anchor spans in top-level body paragraphs as JSON
    /// `[{"id","path","start","end"}]` (char offsets). Comments anchored
    /// inside tables are not reported yet. Read-only.
    pub fn comment_spans(&mut self) -> Result<String, JsValue> {
        let doc = self.doc.as_ref().ok_or_else(|| err("no document loaded"))?;
        let mut out: Vec<serde_json::Value> = Vec::new();
        for (i, item) in doc.body_items().enumerate() {
            let rdocx::BodyItemRef::Paragraph(p) = item else {
                continue;
            };
            for (id, start, end) in p.comment_spans() {
                out.push(serde_json::json!({
                    "id": id,
                    "path": format!("d/{i}"),
                    "start": start,
                    "end": end,
                }));
            }
        }
        serde_json::to_string(&out).map_err(err)
    }

    /// Page geometry of the final section as JSON (pt):
    /// `{"w":..,"h":..,"landscape":bool,"mt":..,"mr":..,"mb":..,"ml":..}`.
    /// Missing values report Word's Letter defaults. Read-only.
    pub fn page_info(&mut self) -> Result<String, JsValue> {
        let doc = self.doc.as_ref().ok_or_else(|| err("no document loaded"))?;
        let s = doc.section_properties();
        let w = s
            .and_then(|s| s.page_width)
            .map(|t| t.0 as f64 / 20.0)
            .unwrap_or(612.0);
        let h = s
            .and_then(|s| s.page_height)
            .map(|t| t.0 as f64 / 20.0)
            .unwrap_or(792.0);
        let mt = s.and_then(|s| s.margin_top).map(|t| t.0 as f64 / 20.0).unwrap_or(72.0);
        let mr = s.and_then(|s| s.margin_right).map(|t| t.0 as f64 / 20.0).unwrap_or(72.0);
        let mb = s.and_then(|s| s.margin_bottom).map(|t| t.0 as f64 / 20.0).unwrap_or(72.0);
        let ml = s.and_then(|s| s.margin_left).map(|t| t.0 as f64 / 20.0).unwrap_or(72.0);
        Ok(format!(
            r#"{{"w":{w},"h":{h},"landscape":{},"mt":{mt},"mr":{mr},"mb":{mb},"ml":{ml}}}"#,
            w > h,
        ))
    }

    /// Set the paper size (portrait dimensions in pt), preserving the
    /// current orientation. One history entry.
    pub fn set_paper(&mut self, w_pt: f64, h_pt: f64) -> Result<String, JsValue> {
        if !(100.0..=4000.0).contains(&w_pt) || !(100.0..=4000.0).contains(&h_pt) {
            return Err(err("paper size out of range"));
        }
        self.mutate(
            move |d| {
                let landscape = d
                    .section_properties()
                    .and_then(|s| Some((s.page_width?, s.page_height?)))
                    .map(|(w, h)| w.0 > h.0)
                    .unwrap_or(false);
                d.set_page_size(
                    rdocx::Length::twips((w_pt * 20.0) as i32),
                    rdocx::Length::twips((h_pt * 20.0) as i32),
                );
                if landscape {
                    d.set_landscape();
                } else {
                    d.set_portrait();
                }
                true
            },
            "paper size",
        )
    }

    /// Set the page orientation. One history entry.
    pub fn set_orientation(&mut self, landscape: bool) -> Result<String, JsValue> {
        self.mutate(
            move |d| {
                if landscape {
                    d.set_landscape();
                } else {
                    d.set_portrait();
                }
                true
            },
            "orientation",
        )
    }

    /// Set all page margins (pt). One history entry.
    pub fn set_margins_pt(
        &mut self,
        top: f64,
        right: f64,
        bottom: f64,
        left: f64,
    ) -> Result<String, JsValue> {
        for v in [top, right, bottom, left] {
            if !(0.0..=500.0).contains(&v) {
                return Err(err("margin out of range"));
            }
        }
        self.mutate(
            move |d| {
                let l = |pt: f64| rdocx::Length::twips((pt * 20.0) as i32);
                d.set_margins(l(top), l(right), l(bottom), l(left));
                true
            },
            "margins",
        )
    }

    /// Insert a rows x cols table (equal column widths, single gray
    /// borders, one empty paragraph per cell) right AFTER the caret's
    /// top-level body paragraph, as one history entry.
    pub fn insert_table_after(
        &mut self,
        path: &str,
        rows: usize,
        cols: usize,
    ) -> Result<String, JsValue> {
        if !(1..=50).contains(&rows) || !(1..=20).contains(&cols) {
            return Err(err("table size out of range"));
        }
        let Some(crate::EditPath::Doc(ch)) = parse_edit_path(path) else {
            return Err(err("tables insert in the body story"));
        };
        if ch.len() != 1 {
            return Err(err("put the caret in a top-level body paragraph"));
        }
        let index = ch[0] + 1;
        self.mutate(
            move |d| {
                let mut table = d.insert_table(index, rows, cols);
                table.set_borders(rdocx::BorderStyle::Single, 4, "808080");
                true
            },
            "insert table",
        )
    }

    /// Grid column widths (pt) of the table at a body index ("d/T" or any
    /// cell path inside it). Read-only.
    pub fn table_grid_pt(&mut self, path: &str) -> Result<String, JsValue> {
        let Some(crate::EditPath::Doc(ch)) = parse_edit_path(path) else {
            return Err(err("not a body table"));
        };
        let doc = self.doc.as_ref().ok_or_else(|| err("no document loaded"))?;
        let Some(ordinal) = table_ordinal(doc, ch[0]) else {
            return Err(err("no table at that body index"));
        };
        let widths: Vec<f64> = doc
            .table(ordinal)
            .map(|t| t.grid_column_widths())
            .unwrap_or_default()
            .into_iter()
            .map(|tw| tw as f64 / 20.0)
            .collect();
        serde_json::to_string(&widths).map_err(err)
    }

    /// Set one grid column's width (pt) of the table at a body index —
    /// spanning cells receive summed widths upstream. One history entry.
    pub fn set_table_column_width(
        &mut self,
        path: &str,
        col: usize,
        width_pt: f64,
    ) -> Result<String, JsValue> {
        if !(10.0..=1000.0).contains(&width_pt) {
            return Err(err("column width out of range"));
        }
        let Some(crate::EditPath::Doc(ch)) = parse_edit_path(path) else {
            return Err(err("not a body table"));
        };
        let body_index = ch[0];
        self.mutate(
            move |d| {
                let Some(ordinal) = table_ordinal(d, body_index) else {
                    return false;
                };
                d.table_mut(ordinal)
                    .map(|mut t| t.set_column_width(col, rdocx::Length::twips((width_pt * 20.0) as i32)))
                    .unwrap_or(false)
            },
            "column width",
        )
    }

    /// Render the current document to PDF bytes — same fonts, aliases,
    /// and revision view as the screen. Read-only (no history entry).
    pub fn save_pdf(&mut self) -> Result<Vec<u8>, JsValue> {
        let doc = self.doc.as_ref().ok_or_else(|| err("no document loaded"))?;
        let fonts: Vec<(&str, &[u8])> = self
            .fonts
            .iter()
            .map(|(family, data)| (family.as_str(), data.as_slice()))
            .collect();
        let aliases: Vec<(&str, &str)> = self
            .aliases
            .iter()
            .map(|(requested, target)| (requested.as_str(), target.as_str()))
            .collect();
        let options = rdocx::RenderOptions {
            revision_view: if self.tracked_view {
                rdocx::RevisionView::Tracked
            } else {
                rdocx::RevisionView::Accepted
            },
        };
        let layout = doc
            .layout_with_fonts_aliases_options_and_bundled_fallback(&fonts, &aliases, options)
            .map_err(err)?;
        Ok(oxml_pdf::render_to_pdf(&layout.layout))
    }

    /// Scale every grid column of the table at a body index so the total
    /// width becomes `total_pt` (proportional resize). One history entry.
    pub fn set_table_total_width(
        &mut self,
        path: &str,
        total_pt: f64,
    ) -> Result<String, JsValue> {
        let Some(crate::EditPath::Doc(ch)) = parse_edit_path(path) else {
            return Err(err("not a body table"));
        };
        let body_index = ch[0];
        self.mutate(
            move |d| {
                let Some(ordinal) = table_ordinal(d, body_index) else {
                    return false;
                };
                let widths = match d.table(ordinal) {
                    Some(t) => t.grid_column_widths(),
                    None => return false,
                };
                let old_total: i64 = widths.iter().map(|&w| w as i64).sum();
                if old_total <= 0 {
                    return false;
                }
                let ratio = (total_pt * 20.0) / old_total as f64;
                // Keep every column at least 10pt and the table sane.
                let min_ratio = widths
                    .iter()
                    .map(|&w| 200.0 / w.max(1) as f64)
                    .fold(0.0f64, f64::max);
                let ratio = ratio.max(min_ratio).min(2000.0 * 20.0 / old_total as f64);
                if !(ratio.is_finite() && ratio > 0.0) || (ratio - 1.0).abs() < 1e-4 {
                    return false;
                }
                let mut t = match d.table_mut(ordinal) {
                    Some(t) => t,
                    None => return false,
                };
                let mut any = false;
                for (col, &w) in widths.iter().enumerate() {
                    let new_w = ((w as f64 * ratio).round() as i32).max(200);
                    any |= t.set_column_width(col, rdocx::Length::twips(new_w));
                }
                any
            },
            "table width",
        )
    }

    /// Move the top-level body item at index `from` to index `to` (the
    /// item ends up AT `to` in the new order). One history entry.
    pub fn move_body_item(&mut self, from: usize, to: usize) -> Result<String, JsValue> {
        if from == to {
            return Err(err("same position"));
        }
        self.mutate(move |d| d.move_content(from, to), "move")
    }

    /// Merge horizontally adjacent cells of one top-level-table row, as
    /// one history entry. Input: JSON array of cell paragraph paths
    /// ("d/T.R.C.P"); they must share the table and row and cover
    /// contiguous cell indices.
    pub fn merge_cells(&mut self, json: &str) -> Result<String, JsValue> {
        let paths: Vec<String> =
            serde_json::from_str(json).map_err(|_| err("bad paths json"))?;
        let mut cells: Vec<(usize, usize, usize)> = Vec::new();
        for path in &paths {
            let Some(crate::EditPath::Doc(ch)) = parse_edit_path(path) else {
                return Err(err("not a table cell"));
            };
            if ch.len() != 4 {
                return Err(err("not a top-level table cell"));
            }
            cells.push((ch[0], ch[1], ch[2]));
        }
        cells.sort();
        cells.dedup();
        if cells.len() < 2 {
            return Err(err("select at least two cells"));
        }
        let (t, r, c0) = cells[0];
        if !cells.iter().all(|&(tt, rr, _)| tt == t && rr == r) {
            return Err(err("cells must share one row"));
        }
        if !cells
            .iter()
            .enumerate()
            .all(|(i, &(_, _, cc))| cc == c0 + i)
        {
            return Err(err("cells must be adjacent"));
        }
        let count = cells.len();
        self.mutate(move |d| d.table_merge_cells(t, r, c0, count), "merge cells")
    }

    /// Split a horizontally merged cell back into its grid columns, as
    /// one history entry. Input: any paragraph path inside the cell.
    pub fn split_cell(&mut self, path: &str) -> Result<String, JsValue> {
        let Some(crate::EditPath::Doc(ch)) = parse_edit_path(path) else {
            return Err(err("not a table cell"));
        };
        if ch.len() != 4 {
            return Err(err("not a top-level table cell"));
        }
        let (t, r, c) = (ch[0], ch[1], ch[2]);
        self.mutate(move |d| d.table_split_cell(t, r, c), "split cell")
    }

    /// Set paragraph alignment ('l' | 'c' | 'r' | 'j') for every path in
    /// the JSON string array, as one history entry (a selection can span
    /// several paragraphs).
    pub fn set_alignment_paths(&mut self, json: &str, align: char) -> Result<String, JsValue> {
        let paths: Vec<String> =
            serde_json::from_str(json).map_err(|e| err(&format!("bad paths: {e}")))?;
        if paths.is_empty() {
            return Err(err("no paragraphs"));
        }
        let ats: Vec<crate::EditPath> = paths
            .iter()
            .map(|p| parse_edit_path(p).ok_or_else(|| err("not an editable location")))
            .collect::<Result<_, _>>()?;
        self.mutate(
            move |d| ats.iter().all(|at| crate::set_alignment_at(d, at, align)),
            "align",
        )
    }

    /// Toggle bold/italic/underline over per-paragraph ranges with Word's
    /// whole-selection semantics: if every covered run already carries the
    /// format, clear it, otherwise set it — one history entry.
    pub fn toggle_ranges(&mut self, json: &str, fmt: char) -> Result<String, JsValue> {
        let ranges = Self::parse_ranges(json)?;
        self.mutate(
            move |d| {
                let all_on = ranges
                    .iter()
                    .all(|(at, s, e)| crate::format_all_on_at(d, at, *s, *e, fmt) == Some(true));
                ranges
                    .iter()
                    .all(|(at, s, e)| crate::set_format_at(d, at, *s, *e, fmt, !all_on))
            },
            "toggle",
        )
    }

    /// Read-only: whether every run the ranges cover carries the format
    /// (drives tests and, later, toolbar button states).
    pub fn ranges_format_on(&mut self, json: &str, fmt: char) -> Result<bool, JsValue> {
        let ranges = Self::parse_ranges(json)?;
        let doc = self.doc.as_mut().ok_or_else(|| err("no document loaded"))?;
        Ok(ranges
            .iter()
            .all(|(at, s, e)| crate::format_all_on_at(doc, at, *s, *e, fmt) == Some(true)))
    }

    /// Set the font size (pt) over per-paragraph ranges (the decomposed
    /// shape of any selection), as one history entry.
    pub fn set_size_ranges(&mut self, json: &str, pt: f64) -> Result<String, JsValue> {
        let ranges = Self::parse_ranges(json)?;
        self.mutate(
            move |d| {
                ranges
                    .iter()
                    .all(|(at, s, e)| crate::set_size_at(d, at, *s, *e, pt))
            },
            "font size",
        )
    }

    /// Formatting at a caret position as JSON
    /// (`{bold, italic, underline, size, family, color}`), read from the
    /// run left of the offset — for toolbar state display. Read-only.
    pub fn caret_format(&mut self, path: &str, off: usize) -> Result<String, JsValue> {
        let Some(at) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        let doc = self.doc.as_mut().ok_or_else(|| err("no document loaded"))?;
        let fmt = crate::caret_format_at(doc, &at, off).ok_or_else(|| err("no run at caret"))?;
        serde_json::to_string(&fmt).map_err(err)
    }

    /// Wrap [start, end) of a body paragraph in an external hyperlink,
    /// with Word's default link look, as one history entry. Body story
    /// only: the relationship lives in the document part's rels.
    pub fn set_hyperlink(
        &mut self,
        path: &str,
        start: usize,
        end: usize,
        url: &str,
    ) -> Result<String, JsValue> {
        if !path.starts_with("d/") {
            return Err(err("hyperlinks are supported in the body story only"));
        }
        let Some(at) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        let url = url.to_owned();
        self.mutate(
            move |d| {
                let rel = d.add_hyperlink_relationship(&url);
                crate::set_hyperlink_at(d, &at, start, end, &rel)
            },
            "hyperlink",
        )
    }

    /// The hyperlink URL covering a char offset, or None. Read-only.
    pub fn hyperlink_at(&mut self, path: &str, off: usize) -> Result<Option<String>, JsValue> {
        let Some(at) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        let doc = self.doc.as_mut().ok_or_else(|| err("no document loaded"))?;
        let Some(rel) = crate::hyperlink_rel_at(doc, &at, off) else {
            return Ok(None);
        };
        Ok(doc.hyperlink_url(&rel))
    }

    /// Remove the hyperlink covering a char offset (text and formatting
    /// cleanup included), as one history entry.
    pub fn remove_hyperlink(&mut self, path: &str, off: usize) -> Result<String, JsValue> {
        let Some(at) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        self.mutate(move |d| crate::remove_hyperlink_at(d, &at, off), "unlink")
    }

    /// Set multiplied line spacing over whole paragraphs (JSON array of
    /// hit paths), as one history entry.
    pub fn set_line_spacing_paths(&mut self, json: &str, multiple: f64) -> Result<String, JsValue> {
        let paths: Vec<String> =
            serde_json::from_str(json).map_err(|_| err("bad paths json"))?;
        let ats: Vec<crate::EditPath> = paths
            .iter()
            .map(|p| parse_edit_path(p).ok_or_else(|| err("not an editable location")))
            .collect::<Result<_, _>>()?;
        self.mutate(
            move |d| ats.iter().all(|at| crate::set_line_spacing_at(d, at, multiple)),
            "line spacing",
        )
    }

    /// Toggle bullet/numbered list membership over whole paragraphs (JSON
    /// array of hit paths), as one history entry. Word semantics: if every
    /// paragraph is already a list of the requested kind, the list is
    /// removed; otherwise all become that kind (levels preserved).
    pub fn toggle_list_paths(&mut self, json: &str, bullet: bool) -> Result<String, JsValue> {
        let paths: Vec<String> =
            serde_json::from_str(json).map_err(|_| err("bad paths json"))?;
        let ats: Vec<crate::EditPath> = paths
            .iter()
            .map(|p| parse_edit_path(p).ok_or_else(|| err("not an editable location")))
            .collect::<Result<_, _>>()?;
        self.mutate(
            move |d| {
                let all_on = ats.iter().all(|at| {
                    crate::list_numbering_at(d, at)
                        .map(|(num_id, _)| d.numbering_is_bullet(num_id) == Some(bullet))
                        .unwrap_or(false)
                });
                if all_on {
                    return ats.iter().all(|at| crate::set_list_at(d, at, None));
                }
                let num_id = d.ensure_list_num(bullet);
                ats.iter().all(|at| {
                    let level = crate::list_numbering_at(d, at).map(|(_, l)| l).unwrap_or(0);
                    crate::set_list_at(d, at, Some((num_id, level)))
                })
            },
            "list",
        )
    }

    /// The paragraph's list state as JSON `{"bullet":bool,"level":n}`, or
    /// `"null"` when it is not a list paragraph. Read-only.
    pub fn list_info(&mut self, path: &str) -> Result<String, JsValue> {
        let Some(at) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        let doc = self.doc.as_mut().ok_or_else(|| err("no document loaded"))?;
        match crate::list_numbering_at(doc, &at) {
            Some((num_id, level)) => {
                let bullet = doc.numbering_is_bullet(num_id).unwrap_or(true);
                Ok(format!(r#"{{"bullet":{bullet},"level":{level}}}"#))
            }
            None => Ok("null".to_string()),
        }
    }

    /// Change a list paragraph's indentation level by `delta` (clamped to
    /// 0..=8), one history entry. Errors when the paragraph is not a list.
    pub fn set_list_level(&mut self, path: &str, delta: i32) -> Result<String, JsValue> {
        let Some(at) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        self.mutate(
            move |d| match crate::list_numbering_at(d, &at) {
                Some((num_id, level)) => {
                    let new_level = (level as i32 + delta).clamp(0, 8) as u32;
                    crate::set_list_at(d, &at, Some((num_id, new_level)))
                }
                None => false,
            },
            "list level",
        )
    }

    /// Set the font family over per-paragraph ranges, as one history entry.
    pub fn set_family_ranges(&mut self, json: &str, family: &str) -> Result<String, JsValue> {
        let ranges = Self::parse_ranges(json)?;
        let family = family.to_owned();
        self.mutate(
            move |d| {
                ranges
                    .iter()
                    .all(|(at, s, e)| crate::set_family_at(d, at, *s, *e, &family))
            },
            "font family",
        )
    }

    /// Set the text color (6-digit hex, no '#') over per-paragraph ranges,
    /// as one history entry.
    pub fn set_color_ranges(&mut self, json: &str, hex: &str) -> Result<String, JsValue> {
        let ranges = Self::parse_ranges(json)?;
        let hex = hex.to_owned();
        self.mutate(
            move |d| {
                ranges
                    .iter()
                    .all(|(at, s, e)| crate::set_color_at(d, at, *s, *e, &hex))
            },
            "text color",
        )
    }

    /// Paste plain text at (path, char offset) as one history entry.
    /// Newlines (any convention) become paragraph splits, so a multi-line
    /// paste produces the same structure as typing the lines with Enter.
    pub fn paste_text(&mut self, path: &str, offset: usize, text: &str) -> Result<String, JsValue> {
        let Some(start) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        let lines: Vec<String> = text
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .split('\n')
            .map(str::to_owned)
            .collect();
        self.mutate(
            move |d| {
                let mut at = start.clone();
                let mut off = offset;
                for (i, line) in lines.iter().enumerate() {
                    if !line.is_empty() && !insert_text_at(d, &at, off, line) {
                        return false;
                    }
                    off += line.chars().count();
                    if i + 1 < lines.len() {
                        if !crate::split_at(d, &at, off) {
                            return false;
                        }
                        let (_, idx) = crate::sibling_locus(&at);
                        at = crate::at_sibling(&at, idx + 1);
                        off = 0;
                    }
                }
                true
            },
            "paste",
        )
    }

    /// Merge the paragraph at any editable hit path into its previous
    /// sibling in the same container (Backspace at offset 0).
    pub fn merge(&mut self, path: &str) -> Result<String, JsValue> {
        let Some(at) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        self.mutate(
            move |d| match &at {
                crate::EditPath::Doc(children) => d.merge_paragraph_at_path(children),
                crate::EditPath::HeaderFooter {
                    is_header,
                    rel_id,
                    para,
                } => d.merge_header_footer_paragraph(*is_header, rel_id, *para),
                crate::EditPath::Note {
                    is_footnote: true,
                    id,
                    para,
                } => d.merge_footnote_paragraph(*id, *para),
                crate::EditPath::Note {
                    is_footnote: false,
                    id,
                    para,
                } => d.merge_endnote_paragraph(*id, *para),
            },
            "merge",
        )
    }

    /// Toggle bold ('b'), italic ('i'), or underline ('u') over a range.
    pub fn toggle(
        &mut self,
        path: &str,
        start: usize,
        end: usize,
        fmt: char,
    ) -> Result<String, JsValue> {
        let Some(at) = parse_edit_path(path) else {
            return Err(err("not an editable location"));
        };
        self.mutate(move |d| toggle_at(d, &at, start, end, fmt), "toggle")
    }

    /// Insert a new empty footnote referenced at (Document-story path,
    /// char offset). One history entry; the new note id is readable via
    /// `last_note_id` until the next insertion.
    pub fn insert_footnote(&mut self, path: &str, offset: usize) -> Result<String, JsValue> {
        let Some(children) = parse_doc_path(path) else {
            return Err(err("footnotes can only be referenced from the document body"));
        };
        let created = std::rc::Rc::new(std::cell::Cell::new(None));
        let seen = created.clone();
        let out = self.mutate(
            move |d| match d.insert_footnote_ref_at(&children, offset) {
                Some(id) => {
                    seen.set(Some(id));
                    true
                }
                None => false,
            },
            "insert footnote",
        )?;
        self.last_note_id = created.get();
        Ok(out)
    }

    /// The id created by the most recent successful `insert_footnote` or
    /// `insert_endnote`.
    pub fn last_note_id(&self) -> Option<i32> {
        self.last_note_id
    }

    /// Insert a new empty endnote referenced at (Document-story path,
    /// char offset). One history entry; the new note id is readable via
    /// `last_note_id` until the next insertion.
    pub fn insert_endnote(&mut self, path: &str, offset: usize) -> Result<String, JsValue> {
        let Some(children) = parse_doc_path(path) else {
            return Err(err("endnotes can only be referenced from the document body"));
        };
        let created = std::rc::Rc::new(std::cell::Cell::new(None));
        let seen = created.clone();
        let out = self.mutate(
            move |d| match d.insert_endnote_ref_at(&children, offset) {
                Some(id) => {
                    seen.set(Some(id));
                    true
                }
                None => false,
            },
            "insert endnote",
        )?;
        self.last_note_id = created.get();
        Ok(out)
    }

    /// Delete the endnote a hit path points into, along with every
    /// reference marker in the body. One history entry.
    pub fn delete_endnote(&mut self, path: &str) -> Result<String, JsValue> {
        let Some(crate::EditPath::Note {
            is_footnote: false,
            id,
            ..
        }) = parse_edit_path(path)
        else {
            return Err(err("not an endnote location"));
        };
        self.mutate(move |d| d.remove_endnote(id), "delete endnote")
    }

    /// Delete the footnote a hit path points into, along with every
    /// reference marker in the body. One history entry.
    pub fn delete_footnote(&mut self, path: &str) -> Result<String, JsValue> {
        let Some(crate::EditPath::Note {
            is_footnote: true,
            id,
            ..
        }) = parse_edit_path(path)
        else {
            return Err(err("not a footnote location"));
        };
        self.mutate(move |d| d.remove_footnote(id), "delete footnote")
    }

    /// paragraphs()-order index of a body hit path, for caret arithmetic
    /// around split/merge. None for table cells and non-document stories.
    pub fn path_order(&self, path: &str) -> Option<usize> {
        let children = parse_doc_path(path)?;
        if children.len() != 1 {
            return None;
        }
        body_order_of(self.doc.as_ref()?, children[0])
    }

    /// Hit path of the nth body paragraph (inverse of `path_order`).
    pub fn order_path(&self, order: usize) -> Option<String> {
        let doc = self.doc.as_ref()?;
        let body_index = doc.paragraph_body_index(order)?;
        Some(format!("d/{body_index}"))
    }

    /// Text of the paragraph at any editable hit path.
    pub fn paragraph_text_at(&self, path: &str) -> Option<String> {
        let at = parse_edit_path(path)?;
        text_at(self.doc.as_ref()?, &at)
    }

    pub fn undo(&mut self) -> Result<String, JsValue> {
        self.composing = false;
        let prev = self.undo.pop().ok_or_else(|| err("nothing to undo"))?;
        if let Some(doc) = self.doc.as_mut()
            && let Ok(cur) = doc.to_bytes()
        {
            self.redo.push(cur);
        }
        self.replace_doc(rdocx::Document::from_bytes(&prev).map_err(err)?);
        self.render()
    }

    pub fn redo(&mut self) -> Result<String, JsValue> {
        self.composing = false;
        let next = self.redo.pop().ok_or_else(|| err("nothing to redo"))?;
        if let Some(doc) = self.doc.as_mut()
            && let Ok(cur) = doc.to_bytes()
        {
            self.undo.push(cur);
        }
        self.replace_doc(rdocx::Document::from_bytes(&next).map_err(err)?);
        self.render()
    }

    /// Swap in a restored document, carrying the fallback layout engine
    /// (and its content-keyed relayout caches) over so undo/redo do not go
    /// cache-cold. Interim fork API until F-X039's session design lands.
    fn replace_doc(&mut self, new_doc: rdocx::Document) {
        if let Some(old) = self.doc.as_ref()
            && let Some(engine) = old.take_layout_engine()
        {
            new_doc.set_layout_engine(engine);
        }
        self.doc = Some(new_doc);
    }

    /// The demo document as .docx bytes, for a download link.
    pub fn demo_docx(&self) -> Result<Vec<u8>, JsValue> {
        let mut doc = crate::build_demo_doc();
        doc.to_bytes().map_err(err)
    }

    /// The current document saved back to .docx bytes.
    pub fn save_docx(&mut self) -> Result<Vec<u8>, JsValue> {
        let doc = self.doc.as_mut().ok_or_else(|| err("no document loaded"))?;
        doc.to_bytes().map_err(err)
    }

    /// Body paragraph texts of the current document (round-trip checks).
    pub fn paragraph_texts(&self) -> Result<Vec<String>, JsValue> {
        let doc = self.doc.as_ref().ok_or_else(|| err("no document loaded"))?;
        Ok(doc.paragraphs().iter().map(|p| p.text()).collect())
    }
}

fn err<E: std::fmt::Display>(e: E) -> JsValue {
    JsValue::from_str(&e.to_string())
}
