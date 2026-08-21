//! PoC: render rdocx layout output (positioned pages + glyph runs) to SVG.
//!
//! Pipeline: DOCX -> rdocx parse/model -> rdocx-layout (shaping, line
//! breaking, pagination) -> positioned PageFrames -> SVG. Glyphs are
//! converted to vector paths via ttf-parser from the raw font bytes the
//! layout result carries, so the SVG is self-contained: no fonts needed on
//! the viewing machine.
//!
//! Builds for both native (system font discovery) and wasm32 (fonts are
//! supplied by the caller, e.g. fetched by the browser).

use std::collections::HashMap;
use std::fmt::Write as _;

use base64::Engine as _;
use oxml_layout::{
    Color, FontData, FontId, GlyphRun, LayoutResult, Paint, Path as LxPath, PathCommand,
    PositionedElement,
};
use rdocx::{Alignment, BorderStyle, Document};

#[cfg(target_arch = "wasm32")]
mod wasm;
#[cfg(target_arch = "wasm32")]
pub use wasm::SvgConverter;

/// Render every page of a layout result to a standalone SVG string.
pub fn render_layout_to_svg(layout: &LayoutResult) -> Vec<String> {
    let mut renderer = SvgRenderer::new(&layout.fonts);
    layout
        .pages
        .iter()
        .map(|page| renderer.render_page(page))
        .collect()
}

/// Build the demo document exercising text styles, Korean shaping, lists,
/// and tables. Shared by the native binary and the wasm demo button.
pub fn build_demo_doc() -> Document {
    let mut doc = Document::new();

    doc.add_paragraph("rdocx SVG Rendering PoC").style("Heading1");

    let mut p = doc.add_paragraph("");
    p.add_run("This page was laid out by ");
    p.add_run("rdocx-layout").bold(true);
    p.add_run(" (shaping, line breaking, pagination) and rendered to ");
    p.add_run("SVG").italic(true);
    p.add_run(" by a new backend that converts every glyph to a vector path. ");
    p.add_run("No fonts are needed to view it.").underline(true);

    let mut p = doc.add_paragraph("");
    p.add_run("Styled runs: ");
    p.add_run("bold").bold(true);
    p.add_run(", ");
    p.add_run("italic").italic(true);
    p.add_run(", ");
    p.add_run("red").color("FF0000");
    p.add_run(", ");
    p.add_run("strikethrough").strike(true);
    p.add_run(", ");
    p.add_run("large 16pt").size(16.0);
    p.add_run(".");

    doc.add_paragraph("한글 조판 테스트 — 서버 없이 브라우저에서 그대로 보이는 문서입니다. 글리프가 벡터 패스로 내장되어 뷰어 쪽 폰트와 무관하게 동일하게 렌더링됩니다.");

    doc.add_paragraph("Layout features exercised below: a bulleted list and a bordered table with header shading.");

    doc.add_bullet_list_item("Glyph outlines extracted with ttf-parser", 0);
    doc.add_bullet_list_item("Deduplicated into <defs>, placed with <use>", 0);
    doc.add_bullet_list_item("Lines, rects, and images map 1:1 to SVG", 0);

    let mut table = doc
        .add_table(4, 3)
        .borders(BorderStyle::Single, 8, "444444");
    for (c, head) in ["Element", "Layout type", "SVG output"].iter().enumerate() {
        if let Some(mut cell) = table.cell(0, c) {
            cell.set_shading("D9E2F3");
            cell.set_text(head);
            if let Some(mut p) = cell.paragraph_mut(0)
                && let Some(mut r) = p.run_mut(0)
            {
                r.set_bold(true);
            }
        }
    }
    let rows = [
        ["Text", "GlyphRun", "<use href=\"#g..\">"],
        ["Border", "Line", "<line>"],
        ["Shading", "FilledRect", "<rect>"],
    ];
    for (r, row) in rows.iter().enumerate() {
        for (c, text) in row.iter().enumerate() {
            if let Some(mut cell) = table.cell(r + 1, c) {
                cell.set_text(text);
            }
        }
    }

    doc.add_paragraph("")
        .alignment(Alignment::Center)
        .add_run("— end of PoC page —")
        .italic(true)
        .color("808080");

    doc
}

// ---------------------------------------------------------------------------
// SVG renderer
// ---------------------------------------------------------------------------

/// Hit-testing record for one rendered glyph run: enough geometry to place a
/// caret between characters, plus (when the provenance mapping succeeds) the
/// document position the run came from.
#[derive(Debug, Clone, serde::Serialize)]
pub struct HitRun {
    /// Matches the `data-hit` attribute on the run's SVG group.
    pub id: usize,
    /// 1-based page number.
    pub page: usize,
    /// Baseline origin (points).
    pub x: f64,
    pub y: f64,
    /// Font size in points (caret height basis).
    pub size: f64,
    /// Per-character advances in points (glyph advances redistributed when
    /// the shaper merged characters, e.g. ligatures).
    pub adv: Vec<f64>,
    /// Original text of the run segment.
    pub text: String,
    /// Body paragraph index this segment maps to, if provenance matching
    /// succeeded. `None` = unreachable by editing (table cells, markers...)
    /// until upstream layout carries real source positions.
    pub para: Option<usize>,
    /// Character offset of this segment within that paragraph.
    pub start: Option<usize>,
}

struct FaceInfo<'a> {
    face: ttf_parser::Face<'a>,
    units_per_em: f64,
}

pub struct SvgRenderer<'a> {
    faces: HashMap<u32, FaceInfo<'a>>,
    /// (font id, glyph id) -> def index, deduplicated across pages.
    glyph_defs: HashMap<(u32, u16), usize>,
    glyph_paths: Vec<String>,
    /// Gradient / clip-path / filter definitions (cumulative, ids unique).
    extra_defs: Vec<String>,
    hits: Vec<HitRun>,
    current_page: usize,
    pub warnings: usize,
}

impl<'a> SvgRenderer<'a> {
    pub fn new(fonts: &'a [FontData]) -> Self {
        let mut faces = HashMap::new();
        for fd in fonts {
            match ttf_parser::Face::parse(&fd.data, fd.face_index) {
                Ok(face) => {
                    let units_per_em = face.units_per_em() as f64;
                    faces.insert(fd.id.0, FaceInfo { face, units_per_em });
                }
                Err(_) => {}
            }
        }
        Self {
            faces,
            glyph_defs: HashMap::new(),
            glyph_paths: Vec::new(),
            extra_defs: Vec::new(),
            hits: Vec::new(),
            current_page: 0,
            warnings: 0,
        }
    }

    /// Hit-testing records collected so far, in emission (reading) order.
    pub fn take_hits(&mut self) -> Vec<HitRun> {
        std::mem::take(&mut self.hits)
    }

    pub fn render_page(&mut self, page: &oxml_layout::PageFrame) -> String {
        self.current_page = page.page_number;
        let mut body = String::new();
        let bg = match &page.background {
            Some(Paint::Solid(c)) => rgb(c),
            Some(_) => {
                self.warnings += 1;
                "white".to_owned()
            }
            None => "white".to_owned(),
        };
        let _ = writeln!(
            body,
            r#"<rect x="0" y="0" width="{}" height="{}" fill="{}"/>"#,
            page.width, page.height, bg
        );
        self.emit_elements(&mut body, &page.elements);

        let mut svg = String::new();
        let _ = writeln!(
            svg,
            r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}pt" height="{h}pt" viewBox="0 0 {w} {h}">"#,
            w = page.width,
            h = page.height
        );
        svg.push_str("<defs>\n");
        for (i, d) in self.glyph_paths.iter().enumerate() {
            let _ = writeln!(svg, r#"<path id="g{i}" d="{d}"/>"#);
        }
        for d in &self.extra_defs {
            svg.push_str(d);
            svg.push('\n');
        }
        svg.push_str("</defs>\n");
        svg.push_str(&body);
        svg.push_str("</svg>\n");
        svg
    }

    fn emit_elements(&mut self, out: &mut String, elements: &[PositionedElement]) {
        for el in elements {
            match el {
                PositionedElement::Text(run) => self.emit_glyph_run(out, run),
                PositionedElement::Line {
                    start,
                    end,
                    width,
                    color,
                    dash_pattern,
                } => {
                    let dash = match dash_pattern {
                        Some((on, off)) => format!(r#" stroke-dasharray="{on} {off}""#),
                        None => String::new(),
                    };
                    let _ = writeln!(
                        out,
                        r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-width="{}"{}{}/>"#,
                        f(start.x), f(start.y), f(end.x), f(end.y),
                        rgb(color), f(*width), opacity_attr("stroke-opacity", color), dash
                    );
                }
                PositionedElement::FilledRect { rect, color } => {
                    let _ = writeln!(
                        out,
                        r#"<rect x="{}" y="{}" width="{}" height="{}" fill="{}"{}/>"#,
                        f(rect.x), f(rect.y), f(rect.width), f(rect.height),
                        rgb(color), opacity_attr("fill-opacity", color)
                    );
                }
                PositionedElement::Image {
                    rect,
                    data,
                    content_type,
                    ..
                } => {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(data);
                    let _ = writeln!(
                        out,
                        r#"<image x="{}" y="{}" width="{}" height="{}" href="data:{};base64,{}"/>"#,
                        f(rect.x), f(rect.y), f(rect.width), f(rect.height), content_type, b64
                    );
                }
                PositionedElement::LinkAnnotation { .. } => {}
                PositionedElement::Path(pe) => {
                    let d = path_data(&pe.path);
                    let fill = match &pe.fill {
                        Some(p) => self.paint_ref(p),
                        None => "none".to_owned(),
                    };
                    let stroke = match &pe.stroke {
                        Some(s) => {
                            let mut attrs = format!(
                                r#" stroke="{}" stroke-width="{}""#,
                                self.paint_ref(&s.paint),
                                f(s.width)
                            );
                            match s.cap {
                                oxml_layout::LineCap::Butt => {}
                                oxml_layout::LineCap::Round => {
                                    attrs.push_str(r#" stroke-linecap="round""#)
                                }
                                oxml_layout::LineCap::Square => {
                                    attrs.push_str(r#" stroke-linecap="square""#)
                                }
                            }
                            match s.join {
                                oxml_layout::LineJoin::Miter => {}
                                oxml_layout::LineJoin::Round => {
                                    attrs.push_str(r#" stroke-linejoin="round""#)
                                }
                                oxml_layout::LineJoin::Bevel => {
                                    attrs.push_str(r#" stroke-linejoin="bevel""#)
                                }
                            }
                            if let Some(dash) = &s.dash {
                                let list: Vec<String> = dash.iter().map(|v| f(*v)).collect();
                                let _ =
                                    write!(attrs, r#" stroke-dasharray="{}""#, list.join(" "));
                            }
                            attrs
                        }
                        None => String::new(),
                    };
                    let rule = match pe.path.fill_rule {
                        oxml_layout::FillRule::NonZero => "nonzero",
                        oxml_layout::FillRule::EvenOdd => "evenodd",
                    };
                    let _ = writeln!(
                        out,
                        r#"<path d="{d}" fill="{fill}" fill-rule="{rule}"{stroke}/>"#
                    );
                }
                PositionedElement::Group(g) => {
                    let t = g.transform;
                    let mut attrs = String::new();
                    if !t.is_identity() {
                        let _ = write!(
                            attrs,
                            r#" transform="matrix({} {} {} {} {} {})""#,
                            f(t.a), f(t.b), f(t.c), f(t.d), f(t.e), f(t.f)
                        );
                    }
                    if g.opacity < 1.0 {
                        let _ = write!(attrs, r#" opacity="{}""#, f(g.opacity));
                    }
                    if let Some(clip) = &g.clip {
                        let id = self.extra_defs.len();
                        let rule = match clip.fill_rule {
                            oxml_layout::FillRule::NonZero => "nonzero",
                            oxml_layout::FillRule::EvenOdd => "evenodd",
                        };
                        self.extra_defs.push(format!(
                            r#"<clipPath id="p{id}"><path d="{}" clip-rule="{rule}"/></clipPath>"#,
                            path_data(clip)
                        ));
                        let _ = write!(attrs, r#" clip-path="url(#p{id})""#);
                    }
                    for effect in &g.effects {
                        match effect {
                            oxml_layout::Effect::OuterShadow {
                                dx,
                                dy,
                                blur,
                                color,
                            } => {
                                let id = self.extra_defs.len();
                                self.extra_defs.push(format!(
                                    r#"<filter id="p{id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="{}" dy="{}" stdDeviation="{}" flood-color="{}" flood-opacity="{}"/></filter>"#,
                                    f(*dx), f(*dy), f(blur / 2.0), rgb(color), f(color.a)
                                ));
                                let _ = write!(attrs, r#" filter="url(#p{id})""#);
                            }
                            _ => {
                                self.warnings += 1;
                            }
                        }
                    }
                    let _ = writeln!(out, "<g{attrs}>");
                    self.emit_elements(out, &g.children);
                    out.push_str("</g>\n");
                }
                _ => {
                    self.warnings += 1;
                }
            }
        }
    }

    fn emit_glyph_run(&mut self, out: &mut String, run: &GlyphRun) {
        let Some(info) = self.faces.get(&run.font_id.0) else {
            self.warnings += 1;
            return;
        };
        let hit_id = self.hits.len();
        self.hits.push(HitRun {
            id: hit_id,
            page: self.current_page,
            x: run.origin.x,
            y: run.origin.y,
            size: run.font_size,
            adv: char_advances(&run.text, &run.advances),
            text: run.text.clone(),
            para: None,
            start: None,
        });
        let scale = run.font_size / info.units_per_em;
        let _ = writeln!(
            out,
            r#"<g data-hit="{hit_id}" fill="{}"{}>"#,
            rgb(&run.color),
            opacity_attr("fill-opacity", &run.color)
        );
        let mut pen_x = run.origin.x;
        for (i, gid) in run.glyph_ids.iter().enumerate() {
            if let Some(def) = glyph_def(
                &mut self.glyph_defs,
                &mut self.glyph_paths,
                info,
                run.font_id,
                *gid,
            ) {
                let _ = writeln!(
                    out,
                    r##"<use href="#g{def}" transform="translate({} {}) scale({} {})"/>"##,
                    f(pen_x),
                    f(run.origin.y),
                    fs(scale),
                    fs(-scale)
                );
            }
            pen_x += run.advances.get(i).copied().unwrap_or(0.0);
        }
        out.push_str("</g>\n");
    }

    /// Paint as an SVG fill/stroke value: a plain color, or a `url(#pN)`
    /// reference to a gradient definition emitted into `<defs>`.
    fn paint_ref(&mut self, paint: &Paint) -> String {
        match paint {
            Paint::Solid(c) => rgb(c),
            Paint::Linear {
                start, end, stops, ..
            } => {
                let id = self.extra_defs.len();
                let mut def = format!(
                    r#"<linearGradient id="p{id}" gradientUnits="userSpaceOnUse" x1="{}" y1="{}" x2="{}" y2="{}">"#,
                    f(start.x), f(start.y), f(end.x), f(end.y)
                );
                for s in stops {
                    let _ = write!(
                        def,
                        r#"<stop offset="{}" stop-color="{}"{}/>"#,
                        f(s.offset),
                        rgb(&s.color),
                        stop_opacity(&s.color)
                    );
                }
                def.push_str("</linearGradient>");
                self.extra_defs.push(def);
                format!("url(#p{id})")
            }
            Paint::Radial {
                center,
                radius,
                focal,
                stops,
                ..
            } => {
                let id = self.extra_defs.len();
                let mut def = format!(
                    r#"<radialGradient id="p{id}" gradientUnits="userSpaceOnUse" cx="{}" cy="{}" r="{}" fx="{}" fy="{}">"#,
                    f(center.x), f(center.y), f(*radius), f(focal.x), f(focal.y)
                );
                for s in stops {
                    let _ = write!(
                        def,
                        r#"<stop offset="{}" stop-color="{}"{}/>"#,
                        f(s.offset),
                        rgb(&s.color),
                        stop_opacity(&s.color)
                    );
                }
                def.push_str("</radialGradient>");
                self.extra_defs.push(def);
                format!("url(#p{id})")
            }
            // Tile needs a media registry to resolve the image; explicit
            // fallback until then.
            Paint::Tile { .. } => {
                self.warnings += 1;
                "gray".to_owned()
            }
        }
    }
}

fn stop_opacity(c: &Color) -> String {
    if c.a < 1.0 {
        format!(r#" stop-opacity="{}""#, f(c.a))
    } else {
        String::new()
    }
}

/// Return the def index for a glyph, outlining it on first use.
fn glyph_def(
    defs: &mut HashMap<(u32, u16), usize>,
    paths: &mut Vec<String>,
    info: &FaceInfo<'_>,
    font_id: FontId,
    gid: u16,
) -> Option<usize> {
    if let Some(&i) = defs.get(&(font_id.0, gid)) {
        return Some(i);
    }
    let mut sink = OutlineSink::default();
    info.face
        .outline_glyph(ttf_parser::GlyphId(gid), &mut sink)?;
    if sink.d.is_empty() {
        return None; // whitespace glyph
    }
    let i = paths.len();
    paths.push(sink.d);
    defs.insert((font_id.0, gid), i);
    Some(i)
}

#[derive(Default)]
struct OutlineSink {
    d: String,
}

impl ttf_parser::OutlineBuilder for OutlineSink {
    fn move_to(&mut self, x: f32, y: f32) {
        let _ = write!(self.d, "M{} {}", g(x), g(y));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let _ = write!(self.d, "L{} {}", g(x), g(y));
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let _ = write!(self.d, "Q{} {} {} {}", g(x1), g(y1), g(x), g(y));
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let _ = write!(
            self.d,
            "C{} {} {} {} {} {}",
            g(x1), g(y1), g(x2), g(y2), g(x), g(y)
        );
    }
    fn close(&mut self) {
        self.d.push('Z');
    }
}

fn path_data(path: &LxPath) -> String {
    let mut d = String::new();
    for cmd in &path.commands {
        match cmd {
            PathCommand::MoveTo(p) => {
                let _ = write!(d, "M{} {}", f(p.x), f(p.y));
            }
            PathCommand::LineTo(p) => {
                let _ = write!(d, "L{} {}", f(p.x), f(p.y));
            }
            PathCommand::CurveTo { c1, c2, to } => {
                let _ = write!(
                    d,
                    "C{} {} {} {} {} {}",
                    f(c1.x), f(c1.y), f(c2.x), f(c2.y), f(to.x), f(to.y)
                );
            }
            PathCommand::Close => d.push('Z'),
        }
    }
    d
}

/// Compact float formatting: trim to 2 decimals, drop trailing zeros.
fn f(v: f64) -> String {
    let s = format!("{v:.2}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-" { "0".into() } else { s.into() }
}

/// Glyph outlines stay in integer font units; format without decimals.
fn g(v: f32) -> String {
    f(v as f64)
}

/// High-precision formatting for scale factors, where 2 decimals is far too
/// coarse (a 12pt glyph in a 2048-upem font scales by 0.0059).
fn fs(v: f64) -> String {
    let s = format!("{v:.7}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-" { "0".into() } else { s.into() }
}

fn rgb(c: &Color) -> String {
    format!(
        "rgb({},{},{})",
        (c.r * 255.0).round() as u8,
        (c.g * 255.0).round() as u8,
        (c.b * 255.0).round() as u8
    )
}

fn opacity_attr(name: &str, c: &Color) -> String {
    if c.a < 1.0 {
        format!(r#" {name}="{}""#, f(c.a))
    } else {
        String::new()
    }
}

// ---------------------------------------------------------------------------
// Hit testing: geometry, provenance mapping, and edit operations
// ---------------------------------------------------------------------------

/// Redistribute per-glyph advances into per-character advances. When the
/// shaper merged characters (ligatures) or split them, fall back to spreading
/// the total width evenly — a PoC approximation that real provenance from the
/// layout engine would make exact (cluster maps exist inside shaping).
fn char_advances(text: &str, glyph_advances: &[f64]) -> Vec<f64> {
    let n_chars = text.chars().count();
    if n_chars == glyph_advances.len() {
        return glyph_advances.to_vec();
    }
    if n_chars == 0 {
        return Vec::new();
    }
    let total: f64 = glyph_advances.iter().sum();
    vec![total / n_chars as f64; n_chars]
}

/// Render all pages and return (svgs, hit runs mapped to body paragraphs).
pub fn render_with_hits(doc: &Document, layout: &LayoutResult) -> (Vec<String>, Vec<HitRun>) {
    let mut renderer = SvgRenderer::new(&layout.fonts);
    let svgs: Vec<String> = layout
        .pages
        .iter()
        .map(|page| renderer.render_page(page))
        .collect();
    let mut hits = renderer.take_hits();
    map_hits_to_doc(doc, &mut hits);
    (svgs, hits)
}

/// Greedy sequential matching of rendered run segments back to body
/// paragraphs. This is the workaround for layout output carrying no source
/// positions (the "provenance" gap): segments are matched by text, in reading
/// order, with a cursor that only moves forward. Segments that never match —
/// table cell content, list markers, headers — stay `None` and are read-only
/// to the editor layer.
pub fn map_hits_to_doc(doc: &Document, hits: &mut [HitRun]) {
    let texts: Vec<String> = doc.paragraphs().iter().map(|p| p.text()).collect();
    let mut cur_p = 0usize;
    let mut cur_off = 0usize; // char offset within texts[cur_p]

    for hit in hits.iter_mut() {
        if hit.text.is_empty() {
            continue;
        }
        // Tiny fragments (single spaces, punctuation) match almost anywhere;
        // only accept them exactly at the cursor.
        let tiny = hit.text.chars().count() <= 1;
        let mut found = None;
        'search: for p in cur_p..texts.len() {
            let hay = &texts[p];
            let from_char = if p == cur_p { cur_off } else { 0 };
            let from_byte = char_to_byte(hay, from_char);
            if tiny {
                // Accept only at the cursor, or at the start of one of the
                // next few paragraphs (a new paragraph often begins with a
                // one-character segment, e.g. a CJK syllable).
                if hay[from_byte..].starts_with(&hit.text) {
                    found = Some((p, from_char));
                    break 'search;
                }
                if p >= cur_p + 3 {
                    break 'search;
                }
                continue;
            }
            if let Some(rel) = hay[from_byte..].find(&hit.text) {
                let at_char = from_char + hay[from_byte..from_byte + rel].chars().count();
                found = Some((p, at_char));
                break 'search;
            }
        }
        if let Some((p, at)) = found {
            hit.para = Some(p);
            hit.start = Some(at);
            cur_p = p;
            cur_off = at + hit.text.chars().count();
        }
    }
}

fn char_to_byte(s: &str, char_idx: usize) -> usize {
    s.char_indices()
        .nth(char_idx)
        .map(|(b, _)| b)
        .unwrap_or(s.len())
}

/// Insert text at a character offset within a body paragraph.
pub fn insert_at(doc: &mut Document, para: usize, char_off: usize, s: &str) -> bool {
    edit_paragraph(doc, para, |text| {
        let b = char_to_byte(text, char_off.min(text.chars().count()));
        let mut nt = String::with_capacity(text.len() + s.len());
        nt.push_str(&text[..b]);
        nt.push_str(s);
        nt.push_str(&text[b..]);
        Some(nt)
    })
}

/// Delete the character before `char_off` (backspace semantics).
pub fn delete_char_before(doc: &mut Document, para: usize, char_off: usize) -> bool {
    if char_off == 0 {
        return false;
    }
    edit_paragraph(doc, para, |text| {
        let n = text.chars().count();
        if char_off > n {
            return None;
        }
        let b0 = char_to_byte(text, char_off - 1);
        let b1 = char_to_byte(text, char_off);
        let mut nt = String::with_capacity(text.len());
        nt.push_str(&text[..b0]);
        nt.push_str(&text[b1..]);
        Some(nt)
    })
}

/// Apply a text edit to the run containing the paragraph-level offset.
/// The closure sees the paragraph's full text with the offset already
/// paragraph-relative; internally the edit is routed to the owning run.
fn edit_paragraph(
    doc: &mut Document,
    para: usize,
    edit: impl Fn(&str) -> Option<String>,
) -> bool {
    let Some(mut p) = doc.paragraph_mut(para) else {
        return false;
    };
    // Reconstruct the paragraph text run-by-run and apply the edit to the
    // concatenation, then write back only the runs whose text changed.
    let n = p.run_count();
    let mut run_texts: Vec<String> = Vec::with_capacity(n);
    for j in 0..n {
        run_texts.push(p.run(j).map(|r| r.text()).unwrap_or_default());
    }
    let full: String = run_texts.concat();
    let Some(new_full) = edit(&full) else {
        return false;
    };
    if n == 0 {
        p.add_run(&new_full);
        return true;
    }
    // Diff against run boundaries: find the first run whose cumulative span
    // covers the change and give it the delta; later runs keep their text.
    // Simplest correct approach for single-point edits: recompute the run
    // texts by carrying the length delta on the run containing the edit.
    let common_prefix = full
        .chars()
        .zip(new_full.chars())
        .take_while(|(a, b)| a == b)
        .count();
    let mut acc = 0usize;
    for j in 0..n {
        let len = run_texts[j].chars().count();
        // The edit belongs to run j when the change point is inside it, or at
        // its end for the last run.
        if common_prefix < acc + len || j == n - 1 {
            let head = char_to_byte(&new_full, acc);
            let keep_tail: usize = run_texts[j + 1..].iter().map(|t| t.chars().count()).sum();
            let tail_char = new_full.chars().count().saturating_sub(keep_tail);
            let tail = char_to_byte(&new_full, tail_char);
            if tail >= head {
                if let Some(mut r) = p.run_mut(j) {
                    r.set_text(&new_full[head..tail]);
                    return true;
                }
            }
            return false;
        }
        acc += len;
    }
    false
}
