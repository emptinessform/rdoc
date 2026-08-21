//! Wasm bindings: DOCX -> SVG entirely in the browser, with a stateful
//! document, editing operations, and snapshot-based undo/redo.
//!
//! System font discovery does not exist on wasm32, so the caller supplies
//! font bytes (fetched by the page) via `add_font`. rdocx's resolution order
//! then is: caller fonts -> fonts embedded in the DOCX -> bundled
//! metric-compatible fonts.

use wasm_bindgen::prelude::*;

use crate::{
    HitRun, RenderCache, delete_char_before, delete_range, insert_at, render_delta,
    split_paragraph, toggle_format,
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
        self.cache.clear();
        Ok(())
    }

    /// Load the built-in demo document (built in the browser).
    pub fn load_demo(&mut self) {
        self.doc = Some(crate::build_demo_doc());
        self.undo.clear();
        self.redo.clear();
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
        let layout = doc.layout_with_fonts(&fonts).map_err(err)?;
        let delta = render_delta(doc, &layout, &mut self.cache);
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
        self.checkpoint()?;
        let doc = self.doc.as_mut().unwrap();
        if !op(doc) {
            // Roll the failed checkpoint back so undo stays truthful.
            self.undo.pop();
            return Err(err(format!("{what} failed at that position")));
        }
        self.render()
    }

    /// Insert text at (paragraph, char offset), then re-render.
    pub fn insert(&mut self, para: usize, offset: usize, text: &str) -> Result<String, JsValue> {
        let text = text.to_owned();
        self.mutate(move |d| insert_at(d, para, offset, &text), "insert")
    }

    /// Delete the character before (paragraph, char offset), then re-render.
    pub fn delete(&mut self, para: usize, offset: usize) -> Result<String, JsValue> {
        self.mutate(move |d| delete_char_before(d, para, offset), "delete")
    }

    /// Delete an arbitrary range (possibly across paragraphs).
    pub fn delete_selection(
        &mut self,
        pa: usize,
        oa: usize,
        pb: usize,
        ob: usize,
    ) -> Result<String, JsValue> {
        self.mutate(move |d| delete_range(d, pa, oa, pb, ob), "delete range")
    }

    /// Replace [start, end) in one paragraph with text (IME composition).
    pub fn replace_range(
        &mut self,
        para: usize,
        start: usize,
        end: usize,
        text: &str,
    ) -> Result<String, JsValue> {
        let text = text.to_owned();
        self.mutate(
            move |d| {
                crate::delete_range_in_para(d, para, start, end)
                    && (text.is_empty() || insert_at(d, para, start, &text))
            },
            "replace",
        )
    }

    /// Split a paragraph at a char offset (Enter).
    pub fn split(&mut self, para: usize, offset: usize) -> Result<String, JsValue> {
        self.mutate(move |d| split_paragraph(d, para, offset), "split")
    }

    /// Merge a paragraph into the previous one (Backspace at offset 0).
    pub fn merge(&mut self, para: usize) -> Result<String, JsValue> {
        self.mutate(move |d| crate::merge_paragraph_into_prev(d, para), "merge")
    }

    /// Toggle bold ('b'), italic ('i'), or underline ('u') over a range.
    pub fn toggle(
        &mut self,
        para: usize,
        start: usize,
        end: usize,
        fmt: char,
    ) -> Result<String, JsValue> {
        self.mutate(move |d| toggle_format(d, para, start, end, fmt), "toggle")
    }

    pub fn undo(&mut self) -> Result<String, JsValue> {
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
        let next = self.redo.pop().ok_or_else(|| err("nothing to redo"))?;
        if let Some(doc) = self.doc.as_mut()
            && let Ok(cur) = doc.to_bytes()
        {
            self.undo.push(cur);
        }
        self.replace_doc(rdocx::Document::from_bytes(&next).map_err(err)?);
        self.render()
    }

    /// Swap in a restored document, carrying the layout engine (and its
    /// content-keyed caches) over so undo/redo do not go cache-cold.
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
