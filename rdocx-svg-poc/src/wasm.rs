//! Wasm bindings: DOCX -> SVG entirely in the browser, with a stateful
//! document, editing operations, and snapshot-based undo/redo.
//!
//! System font discovery does not exist on wasm32, so the caller supplies
//! font bytes (fetched by the page) via `add_font`. rdocx's resolution order
//! then is: caller fonts -> fonts embedded in the DOCX -> bundled
//! metric-compatible fonts.

use wasm_bindgen::prelude::*;

use crate::{
    HitRun, RenderCache, body_order_of, delete_char_at, delete_range, delete_range_at,
    insert_text_at, parse_doc_path, parse_edit_path, render_delta, split_paragraph, text_at,
    toggle_at,
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
    cache: RenderCache,
}

#[derive(serde::Serialize)]
struct RenderOut {
    total: usize,
    pages: Vec<(usize, String)>,
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
            pages: delta.pages,
            hits: delta.hits,
            can_undo: !self.undo.is_empty(),
            can_redo: !self.redo.is_empty(),
        })
        .map_err(err)
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
            // Roll the failed checkpoint back so undo stays truthful.
            if checkpointed {
                self.undo.pop();
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

    /// Delete an arbitrary range. Within one paragraph (body or table cell)
    /// any range works; across paragraphs both ends must be body paragraphs.
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
            return self.mutate(
                move |d| delete_range_at(d, &at, oa.min(ob), oa.max(ob)),
                "delete range",
            );
        }
        let (Some(ca), Some(cb)) = (parse_doc_path(pa), parse_doc_path(pb)) else {
            return Err(err("not an editable location"));
        };
        if ca.len() != 1 || cb.len() != 1 {
            return Err(err(
                "selection edits across table cells are not supported yet",
            ));
        }
        self.mutate(
            move |d| {
                let (Some(a), Some(b)) = (body_order_of(d, ca[0]), body_order_of(d, cb[0]))
                else {
                    return false;
                };
                delete_range(d, a, oa, b, ob)
            },
            "delete range",
        )
    }

    /// Replace a selection with text as one history entry (typing over a
    /// selection). Within one paragraph any range works; across paragraphs
    /// both ends must be body paragraphs.
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
                    delete_range_at(d, &at, lo, hi)
                        && (text.is_empty() || insert_text_at(d, &at, lo, &text))
                },
                "replace selection",
            );
        }
        let (Some(ca), Some(cb)) = (parse_doc_path(pa), parse_doc_path(pb)) else {
            return Err(err("not an editable location"));
        };
        if ca.len() != 1 || cb.len() != 1 {
            return Err(err(
                "selection edits across table cells are not supported yet",
            ));
        }
        self.mutate(
            move |d| {
                let (Some(a), Some(b)) = (body_order_of(d, ca[0]), body_order_of(d, cb[0]))
                else {
                    return false;
                };
                delete_range(d, a, oa, b, ob)
                    && (text.is_empty() || insert_text_at(d, &crate::EditPath::Doc(ca.clone()), oa, &text))
            },
            "replace selection",
        )
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

    /// Split a body paragraph at a char offset (Enter). Table-cell
    /// paragraphs cannot split yet.
    pub fn split(&mut self, path: &str, offset: usize) -> Result<String, JsValue> {
        let Some(children) = parse_doc_path(path) else {
            return Err(err("not an editable location"));
        };
        if children.len() != 1 {
            return Err(err("Enter inside a table cell is not supported yet"));
        }
        self.mutate(
            move |d| {
                let Some(order) = body_order_of(d, children[0]) else {
                    return false;
                };
                split_paragraph(d, order, offset)
            },
            "split",
        )
    }

    /// Merge a body paragraph into the previous one (Backspace at offset 0).
    pub fn merge(&mut self, path: &str) -> Result<String, JsValue> {
        let Some(children) = parse_doc_path(path) else {
            return Err(err("not an editable location"));
        };
        if children.len() != 1 {
            return Err(err("merge inside a table cell is not supported yet"));
        }
        self.mutate(
            move |d| {
                let Some(order) = body_order_of(d, children[0]) else {
                    return false;
                };
                crate::merge_paragraph_into_prev(d, order)
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
