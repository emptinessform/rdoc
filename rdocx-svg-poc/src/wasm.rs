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

#[wasm_bindgen]
pub struct SvgConverter {
    fonts: Vec<(String, Vec<u8>)>,
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
            undo: Vec::new(),
            redo: Vec::new(),
            composing: false,
            last_note_id: None,
            cache: RenderCache::default(),
        }
    }

    /// Register a font available to layout, e.g. one fetched by the page.
    pub fn add_font(&mut self, family: &str, data: &[u8]) {
        self.fonts.push((family.to_owned(), data.to_vec()));
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
        let layout = doc.layout_with_fonts_and_bundled_fallback(&fonts).map_err(err)?;
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
        let layout = doc.layout_with_fonts_and_bundled_fallback(&fonts).map_err(err)?;
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
