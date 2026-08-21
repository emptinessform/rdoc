//! Wasm bindings: DOCX -> SVG entirely in the browser, now with a stateful
//! document for the hit-testing / editing PoC.
//!
//! System font discovery does not exist on wasm32, so the caller supplies
//! font bytes (fetched by the page) via `add_font`. rdocx's resolution order
//! then is: caller fonts -> fonts embedded in the DOCX -> bundled
//! metric-compatible fonts.

use wasm_bindgen::prelude::*;

use crate::{HitRun, delete_char_before, insert_at, render_with_hits};

#[wasm_bindgen]
pub struct SvgConverter {
    fonts: Vec<(String, Vec<u8>)>,
    doc: Option<rdocx::Document>,
}

#[derive(serde::Serialize)]
struct RenderOut<'a> {
    pages: &'a [String],
    hits: &'a [HitRun],
}

#[wasm_bindgen]
impl SvgConverter {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            fonts: Vec::new(),
            doc: None,
        }
    }

    /// Register a font available to layout, e.g. one fetched by the page.
    pub fn add_font(&mut self, family: &str, data: &[u8]) {
        self.fonts.push((family.to_owned(), data.to_vec()));
    }

    /// Load a .docx as the current document.
    pub fn load_docx(&mut self, docx: &[u8]) -> Result<(), JsValue> {
        self.doc = Some(rdocx::Document::from_bytes(docx).map_err(err)?);
        Ok(())
    }

    /// Load the built-in demo document (built in the browser).
    pub fn load_demo(&mut self) {
        self.doc = Some(crate::build_demo_doc());
    }

    /// The demo document as .docx bytes, for a download link.
    pub fn demo_docx(&self) -> Result<Vec<u8>, JsValue> {
        let mut doc = crate::build_demo_doc();
        doc.to_bytes().map_err(err)
    }

    /// Lay out and render the current document.
    /// Returns JSON: {"pages": ["<svg..>", ...], "hits": [HitRun, ...]}.
    pub fn render(&self) -> Result<String, JsValue> {
        let doc = self.doc.as_ref().ok_or_else(|| err("no document loaded"))?;
        let fonts: Vec<(&str, &[u8])> = self
            .fonts
            .iter()
            .map(|(family, data)| (family.as_str(), data.as_slice()))
            .collect();
        let layout = doc.layout_with_fonts(&fonts).map_err(err)?;
        let (pages, hits) = render_with_hits(doc, &layout);
        serde_json::to_string(&RenderOut {
            pages: &pages,
            hits: &hits,
        })
        .map_err(err)
    }

    /// Insert text at (paragraph, char offset), then re-render.
    pub fn insert(&mut self, para: usize, offset: usize, text: &str) -> Result<String, JsValue> {
        let doc = self.doc.as_mut().ok_or_else(|| err("no document loaded"))?;
        if !insert_at(doc, para, offset, text) {
            return Err(err("insert failed at that position"));
        }
        self.render()
    }

    /// Delete the character before (paragraph, char offset), then re-render.
    pub fn delete(&mut self, para: usize, offset: usize) -> Result<String, JsValue> {
        let doc = self.doc.as_mut().ok_or_else(|| err("no document loaded"))?;
        if !delete_char_before(doc, para, offset) {
            return Err(err("delete failed at that position"));
        }
        self.render()
    }

    /// The current document saved back to .docx bytes.
    pub fn save_docx(&mut self) -> Result<Vec<u8>, JsValue> {
        let doc = self.doc.as_mut().ok_or_else(|| err("no document loaded"))?;
        doc.to_bytes().map_err(err)
    }
}

fn err<E: std::fmt::Display>(e: E) -> JsValue {
    JsValue::from_str(&e.to_string())
}
