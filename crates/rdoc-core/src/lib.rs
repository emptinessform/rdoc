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
    doc.set_header("rdoc demo — 머리글도 편집됩니다");
    doc.set_footer_page_number("Page ");

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

    let note_id = doc.add_footnote("각주 내용도 이제 편집됩니다 — 클릭해서 고쳐 보세요.");
    let mut p = doc.add_paragraph("이 문장에는 각주가 달려 있습니다");
    p.add_footnote_ref(note_id);

    let en_id = doc.add_endnote("미주도 본문과 같은 타입 필드입니다 — 문서 끝에서 편집해 보세요.");
    let mut p = doc.add_paragraph("그리고 이 문장에는 미주가 달려 있습니다");
    p.add_endnote_ref(en_id);

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
    /// F-X037 source path of the paragraph this segment renders, as a
    /// compact string: `"d/12"` (body paragraph 12), `"d/12.0.1.0"` (table
    /// cell paragraph, repeating row.cell.content triples), `"h/rId3/0"`,
    /// `"f/rId3/0"`, `"fn/2/0"`, `"en/3/0"`. `None` = decorative or
    /// unattributed content (list markers, evaluated fields, leaders).
    pub path: Option<String>,
    /// Character offset of this segment within that paragraph
    /// (`SourceSpan::char_start`).
    pub start: Option<usize>,
    /// Result-local source node id, resolved into `path` after collection.
    #[serde(skip)]
    node: Option<oxml_layout::SourceNodeId>,
}

struct FaceInfo<'a> {
    face: ttf_parser::Face<'a>,
    units_per_em: f64,
    /// What the face actually is (OS/2), as opposed to what a run asked
    /// for — the gap is bridged with synthetic bold/italic at render time.
    bold: bool,
    italic: bool,
}

pub struct SvgRenderer<'a> {
    faces: HashMap<u32, FaceInfo<'a>>,
    /// (font id, glyph id) -> def index, deduplicated across pages.
    glyph_defs: HashMap<(u32, u16), usize>,
    glyph_paths: Vec<String>,
    /// Gradient / clip-path / filter definitions (per page).
    extra_defs: Vec<String>,
    hits: Vec<HitRun>,
    current_page: usize,
    /// Index into `hits` where the current page's runs start; HitRun.id is
    /// page-local so partial page updates cannot collide.
    page_first_hit: usize,
    /// Id prefix (e.g. "pg3-") so every page's defs are unique in one DOM.
    prefix: String,
    pub warnings: usize,
}

impl<'a> SvgRenderer<'a> {
    pub fn new(fonts: &'a [FontData]) -> Self {
        let mut faces = HashMap::new();
        for fd in fonts {
            match ttf_parser::Face::parse(&fd.data, fd.face_index) {
                Ok(face) => {
                    let units_per_em = face.units_per_em() as f64;
                    let (bold, italic) = (face.is_bold(), face.is_italic());
                    faces.insert(
                        fd.id.0,
                        FaceInfo {
                            face,
                            units_per_em,
                            bold,
                            italic,
                        },
                    );
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
            page_first_hit: 0,
            prefix: String::new(),
            warnings: 0,
        }
    }

    /// Hit-testing records collected so far, in emission (reading) order.
    pub fn take_hits(&mut self) -> Vec<HitRun> {
        std::mem::take(&mut self.hits)
    }

    /// Render one page as a standalone SVG. Definitions (glyphs, gradients,
    /// clips) are per page and prefixed with "pg{N}-" so multiple pages can
    /// share one DOM without id collisions.
    pub fn render_page(&mut self, page: &oxml_layout::PageFrame) -> String {
        self.current_page = page.page_number;
        self.page_first_hit = self.hits.len();
        self.prefix = format!("pg{}-", page.page_number);
        self.glyph_defs.clear();
        self.glyph_paths.clear();
        self.extra_defs.clear();
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
            let _ = writeln!(svg, r#"<path id="{}g{i}" d="{d}"/>"#, self.prefix);
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
                    // Browsers cannot decode WMF/EMF. Word documents often
                    // embed scanned stamps/seals as an EMF that merely wraps
                    // one bitmap — unwrap that to a BMP the browser can
                    // show; skip anything else quietly rather than emit a
                    // broken-image icon.
                    let mut data = data.as_slice();
                    let mut content_type = content_type.as_str();
                    let unwrapped;
                    if content_type.contains("emf") || content_type.contains("wmf") {
                        match emf_wrapped_bitmap(data) {
                            Some(bmp) => {
                                unwrapped = bmp;
                                data = &unwrapped;
                                content_type = "image/bmp";
                            }
                            None => {
                                self.warnings += 1;
                                continue;
                            }
                        }
                    }
                    if data.is_empty() {
                        self.warnings += 1;
                        continue;
                    }
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
                            r#"<clipPath id="{}p{id}"><path d="{}" clip-rule="{rule}"/></clipPath>"#,
                            self.prefix, path_data(clip)
                        ));
                        let _ = write!(attrs, r#" clip-path="url(#{}p{id})""#, self.prefix);
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
                                    r#"<filter id="{}p{id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="{}" dy="{}" stdDeviation="{}" flood-color="{}" flood-opacity="{}"/></filter>"#,
                                    self.prefix, f(*dx), f(*dy), f(blur / 2.0), rgb(color), f(color.a)
                                ));
                                let _ = write!(attrs, r#" filter="url(#{}p{id})""#, self.prefix);
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

    fn push_hit(&mut self, run: &GlyphRun) -> usize {
        let hit_id = self.hits.len() - self.page_first_hit;
        self.hits.push(HitRun {
            id: hit_id,
            page: self.current_page,
            x: run.origin.x,
            y: run.origin.y,
            size: run.font_size,
            adv: char_advances(&run.text, &run.advances),
            text: run.text.clone(),
            path: None,
            start: run.source.map(|span| span.char_start as usize),
            node: run.source.map(|span| span.node),
        });
        hit_id
    }

    /// Collect hit records for a page without generating any SVG — the cheap
    /// pass that runs for every page on every edit, while SVG generation runs
    /// only for pages whose content hash changed.
    pub fn collect_hits(&mut self, page: &oxml_layout::PageFrame) {
        self.current_page = page.page_number;
        self.page_first_hit = self.hits.len();
        fn walk(r: &mut SvgRenderer, elements: &[PositionedElement]) {
            for el in elements {
                match el {
                    PositionedElement::Text(run) => {
                        r.push_hit(run);
                    }
                    PositionedElement::Group(g) => walk(r, &g.children),
                    _ => {}
                }
            }
        }
        walk(self, &page.elements);
    }

    fn emit_glyph_run(&mut self, out: &mut String, run: &GlyphRun) {
        let _hit_id = self.push_hit(run);
        let hit_id = _hit_id;
        let Some(info) = self.faces.get(&run.font_id.0) else {
            self.warnings += 1;
            return;
        };
        let scale = run.font_size / info.units_per_em;
        // The resolved face may lack the requested style (Korean fonts
        // rarely ship italic; the open-font set may lack a bold weight):
        // synthesize like Word does — stroke-thickened outlines for bold,
        // a baseline skew for italic. Advances are left untouched.
        let synth_bold = run.bold && !info.bold;
        let synth_italic = run.italic && !info.italic;
        let stroke = if synth_bold {
            format!(
                r#" stroke="{}" stroke-width="{}""#,
                rgb(&run.color),
                f(run.font_size * 0.03)
            )
        } else {
            String::new()
        };
        let _ = writeln!(
            out,
            r#"<g data-hit="{}{hit_id}" fill="{}"{}{stroke}>"#,
            self.prefix,
            rgb(&run.color),
            opacity_attr("fill-opacity", &run.color)
        );
        let skew = if synth_italic { " skewX(-12)" } else { "" };
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
                    r##"<use href="#{}g{def}" transform="translate({} {}){skew} scale({} {})"/>"##,
                    self.prefix,
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
                    r#"<linearGradient id="{}p{id}" gradientUnits="userSpaceOnUse" x1="{}" y1="{}" x2="{}" y2="{}">"#,
                    self.prefix, f(start.x), f(start.y), f(end.x), f(end.y)
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
                format!("url(#{}p{id})", self.prefix)
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
                    r#"<radialGradient id="{}p{id}" gradientUnits="userSpaceOnUse" cx="{}" cy="{}" r="{}" fx="{}" fy="{}">"#,
                    self.prefix, f(center.x), f(center.y), f(*radius), f(focal.x), f(focal.y)
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
                format!("url(#{}p{id})", self.prefix)
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

#[cfg(test)]
mod edit_tests {
    use super::*;

    fn texts(doc: &Document) -> Vec<String> {
        doc.paragraphs().iter().map(|p| p.text()).collect()
    }

    /// Serialize and re-parse, asserting body text survives the round trip.
    fn roundtrip(doc: &mut Document) -> Document {
        let bytes = doc.to_bytes().expect("to_bytes");
        let re = Document::from_bytes(&bytes).expect("from_bytes");
        assert_eq!(texts(doc), texts(&re), "text differs after docx round trip");
        re
    }

    #[test]
    fn deletion_range_covering_note_ref_removes_note() {
        let mut doc = Document::new();
        doc.add_paragraph("가나다라");
        doc.add_paragraph("마바사아");
        let fn_id = doc.insert_footnote_ref_at(&[0], 2).expect("footnote ref");
        let at0 = EditPath::Doc(vec![0]);

        // Interior coverage finds the reference; boundary-exclusive misses.
        assert_eq!(
            covered_note_refs(&mut doc, &at0, Some(1), Some(3)),
            vec![(true, fn_id)]
        );
        assert!(covered_note_refs(&mut doc, &at0, Some(2), Some(3)).is_empty());

        // Cross-paragraph deletion spanning the marker removes the note.
        let en_id = doc.insert_endnote_ref_at(&[0], 4).expect("endnote ref");
        let at1 = EditPath::Doc(vec![1]);
        assert!(delete_range_across(&mut doc, &at0, 1, &at1, 1));
        assert_eq!(&texts(&doc)[0], "가바사아");
        assert_eq!(doc.footnote_paragraph_text(fn_id, 0), None, "footnote gone");
        assert_eq!(doc.endnote_paragraph_text(en_id, 0), None, "endnote gone");
        roundtrip(&mut doc);
    }

    #[test]
    fn body_selection_spanning_a_table_deletes_it() {
        let mut doc = Document::new();
        doc.add_paragraph("앞 문단");
        let mut table = doc.add_table(1, 1);
        if let Some(mut cell) = table.cell(0, 0) {
            cell.set_text("셀 텍스트");
        }
        doc.add_paragraph("뒤 문단");
        let fn_id = doc
            .insert_footnote_ref_at(&[1, 0, 0, 0], 2)
            .expect("footnote ref inside the cell");

        let a = EditPath::Doc(vec![0]);
        let b = EditPath::Doc(vec![2]);
        assert!(delete_range_across(&mut doc, &a, 2, &b, 2));
        assert_eq!(texts(&doc), vec!["앞 문단".to_owned()], "table removed, ends merged");
        assert_eq!(
            doc.footnote_paragraph_text(fn_id, 0),
            None,
            "note referenced inside the deleted table goes with it"
        );
        roundtrip(&mut doc);
    }

    #[test]
    fn insert_then_delete_restores_text() {
        let mut doc = build_demo_doc();
        let before = texts(&doc);
        assert!(insert_at(&mut doc, 0, 8, "XYZ"));
        assert_eq!(&texts(&doc)[0], "rdocx SVXYZG Rendering PoC");
        for k in 0..3 {
            assert!(delete_char_before(&mut doc, 0, 11 - k));
        }
        assert_eq!(texts(&doc), before);
        roundtrip(&mut doc);
    }

    #[test]
    fn delete_range_within_paragraph_spans_runs() {
        let mut doc = build_demo_doc();
        let full = texts(&doc)[1].clone();
        // Remove chars [5, 30) of the intro paragraph, which crosses the
        // "This page was laid out by " / "rdocx-layout" run boundary.
        assert!(delete_range_in_para(&mut doc, 1, 5, 30));
        let want: String = {
            let cs: Vec<char> = full.chars().collect();
            cs[..5].iter().chain(cs[30..].iter()).collect()
        };
        assert_eq!(texts(&doc)[1], want);
        roundtrip(&mut doc);
    }

    #[test]
    fn split_paragraph_partitions_text_and_keeps_count() {
        let mut doc = build_demo_doc();
        let before = texts(&doc);
        assert!(split_paragraph(&mut doc, 3, 6));
        let after = texts(&doc);
        assert_eq!(after.len(), before.len() + 1);
        let orig: Vec<char> = before[3].chars().collect();
        assert_eq!(after[3], orig[..6].iter().collect::<String>());
        assert_eq!(after[4], orig[6..].iter().collect::<String>());
        assert_eq!(after[5..], before[4..]);
        roundtrip(&mut doc);
    }

    #[test]
    fn merge_restores_split() {
        let mut doc = build_demo_doc();
        let before = texts(&doc);
        assert!(split_paragraph(&mut doc, 3, 6));
        assert!(merge_paragraph_into_prev(&mut doc, 4));
        assert_eq!(texts(&doc), before);
        roundtrip(&mut doc);
    }

    #[test]
    fn cross_paragraph_delete_merges() {
        let mut doc = build_demo_doc();
        let before = texts(&doc);
        // Delete from (1, 5) to (3, 3): tail of 1, all of 2, head 3 of 3.
        assert!(delete_range(&mut doc, 1, 5, 3, 3));
        let after = texts(&doc);
        assert_eq!(after.len(), before.len() - 2);
        let head: String = before[1].chars().take(5).collect();
        let tail: String = before[3].chars().skip(3).collect();
        assert_eq!(after[1], format!("{head}{tail}"));
        roundtrip(&mut doc);
    }

    #[test]
    fn toggle_bold_splits_runs_and_word_semantics() {
        let mut doc = build_demo_doc();
        // "This" (chars 0..4) of the intro paragraph: plain -> bold.
        assert!(toggle_format(&mut doc, 1, 0, 4, 'b'));
        {
            let p = doc.paragraph(1).unwrap();
            let first = p.runs().next().unwrap();
            assert_eq!(first.text(), "This");
            assert!(first.is_bold());
        }
        // Toggling the same range again clears it (all-on -> off).
        assert!(toggle_format(&mut doc, 1, 0, 4, 'b'));
        {
            let p = doc.paragraph(1).unwrap();
            let first = p.runs().next().unwrap();
            assert!(!first.is_bold());
        }
        // Text content untouched throughout.
        assert_eq!(texts(&doc)[1], texts(&build_demo_doc())[1]);
        roundtrip(&mut doc);
    }

    #[test]
    fn replace_range_like_ime_commit() {
        let mut doc = build_demo_doc();
        let before = texts(&doc)[3].clone();
        // Simulate composition at (3, 0): "ㅎ" -> "하" -> "한글" committed.
        assert!(insert_at(&mut doc, 3, 0, "ㅎ"));
        assert!(delete_range_in_para(&mut doc, 3, 0, 1));
        assert!(insert_at(&mut doc, 3, 0, "하"));
        assert!(delete_range_in_para(&mut doc, 3, 0, 1));
        assert!(insert_at(&mut doc, 3, 0, "한글"));
        assert_eq!(texts(&doc)[3], format!("한글{before}"));
        roundtrip(&mut doc);
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
pub fn render_with_hits(layout: &rdocx::WordLayoutResult) -> (Vec<String>, Vec<HitRun>) {
    let mut renderer = SvgRenderer::new(&layout.layout.fonts);
    let svgs: Vec<String> = layout
        .layout
        .pages
        .iter()
        .map(|page| renderer.render_page(page))
        .collect();
    let mut hits = renderer.take_hits();
    resolve_hit_paths(&mut hits, layout);
    (svgs, hits)
}

/// Per-page fingerprints from the previous render, for delta updates.
#[derive(Default)]
pub struct RenderCache {
    element_hashes: Vec<u64>,
    hit_hashes: Vec<u64>,
}

impl RenderCache {
    pub fn clear(&mut self) {
        self.element_hashes.clear();
        self.hit_hashes.clear();
    }
}

/// Pages and hit runs that changed since the cache was last updated.
pub struct RenderDelta {
    pub total_pages: usize,
    /// 0-based indices of pages whose content changed. SVG strings are not
    /// generated here — callers pull them per page via [`render_page_svg`],
    /// so off-screen pages can defer that cost entirely.
    pub changed_pages: Vec<usize>,
    /// (0-based page index, runs) for pages whose hit map changed — a
    /// superset of `changed_pages` when paragraph indices shift without
    /// reflow.
    pub hits: Vec<(usize, Vec<HitRun>)>,
}

struct Fnv(u64);

impl Fnv {
    fn new() -> Self {
        Fnv(0xcbf2_9ce4_8422_2325)
    }
    fn bytes(&mut self, bytes: &[u8]) {
        for b in bytes {
            self.0 ^= u64::from(*b);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    fn f64(&mut self, v: f64) {
        self.bytes(&v.to_bits().to_le_bytes());
    }
}

fn fnv(bytes: &[u8]) -> u64 {
    let mut h = Fnv::new();
    h.bytes(bytes);
    h.0
}

/// Structural hash of a page's positioned elements — cheap relative to SVG
/// string generation, so unchanged pages skip that step entirely.
fn hash_elements(elements: &[PositionedElement], h: &mut Fnv) {
    for el in elements {
        match el {
            PositionedElement::Text(r) => {
                h.bytes(b"t");
                h.f64(r.origin.x);
                h.f64(r.origin.y);
                h.f64(r.font_size);
                h.bytes(&r.font_id.0.to_le_bytes());
                h.bytes(r.text.as_bytes());
                for g in &r.glyph_ids {
                    h.bytes(&g.to_le_bytes());
                }
                h.f64(r.color.r);
                h.f64(r.color.g);
                h.f64(r.color.b);
            }
            PositionedElement::Line {
                start,
                end,
                width,
                color,
                ..
            } => {
                h.bytes(b"l");
                h.f64(start.x);
                h.f64(start.y);
                h.f64(end.x);
                h.f64(end.y);
                h.f64(*width);
                h.f64(color.r);
            }
            PositionedElement::FilledRect { rect, color } => {
                h.bytes(b"r");
                h.f64(rect.x);
                h.f64(rect.y);
                h.f64(rect.width);
                h.f64(rect.height);
                h.f64(color.r);
                h.f64(color.g);
                h.f64(color.b);
            }
            PositionedElement::Image { rect, media_id, .. } => {
                h.bytes(b"i");
                h.f64(rect.x);
                h.f64(rect.y);
                h.f64(rect.width);
                h.f64(rect.height);
                h.bytes(&media_id.0.to_le_bytes());
            }
            PositionedElement::LinkAnnotation { rect, url } => {
                h.bytes(b"a");
                h.f64(rect.x);
                h.f64(rect.y);
                h.bytes(url.as_bytes());
            }
            PositionedElement::Path(pe) => {
                h.bytes(b"p");
                for cmd in &pe.path.commands {
                    match cmd {
                        PathCommand::MoveTo(p) | PathCommand::LineTo(p) => {
                            h.f64(p.x);
                            h.f64(p.y);
                        }
                        PathCommand::CurveTo { c1, to, .. } => {
                            h.f64(c1.x);
                            h.f64(to.x);
                            h.f64(to.y);
                        }
                        PathCommand::Close => h.bytes(b"z"),
                    }
                }
            }
            PositionedElement::Group(g) => {
                h.bytes(b"g");
                h.f64(g.transform.e);
                h.f64(g.transform.f);
                h.f64(g.opacity);
                hash_elements(&g.children, h);
            }
            _ => h.bytes(b"?"),
        }
    }
}

/// Render only what changed relative to `cache`. Hit maps are recollected
/// for every page (cheap, and paragraph indices can shift without reflow),
/// but SVG strings are generated only for pages whose element hash changed
/// — the editor path: a keystroke reflows one page and leaves the other
/// pages' SVG generation, transfer, and DOM untouched.
pub fn render_delta(layout: &rdocx::WordLayoutResult, cache: &mut RenderCache) -> RenderDelta {
    let n = layout.layout.pages.len();
    let mut renderer = SvgRenderer::new(&layout.layout.fonts);

    // Pass 1: hits for every page, no SVG.
    for page in &layout.layout.pages {
        renderer.collect_hits(page);
    }
    let mut hits = renderer.take_hits();
    resolve_hit_paths(&mut hits, layout);
    let mut by_page: Vec<Vec<HitRun>> = vec![Vec::new(); n];
    for h in hits {
        let p = h.page - 1;
        if p < by_page.len() {
            by_page[p].push(h);
        }
    }

    // Pass 2: detect structurally changed pages (hash only — SVG is pulled
    // lazily per page by the caller).
    cache.element_hashes.resize(n, 0);
    cache.hit_hashes.resize(n, 0);
    let mut delta = RenderDelta {
        total_pages: n,
        changed_pages: Vec::new(),
        hits: Vec::new(),
    };
    for (i, page) in layout.layout.pages.iter().enumerate() {
        let mut h = Fnv::new();
        h.f64(page.width);
        h.f64(page.height);
        hash_elements(&page.elements, &mut h);
        if cache.element_hashes[i] != h.0 {
            cache.element_hashes[i] = h.0;
            delta.changed_pages.push(i);
        }
    }

    for (i, runs) in by_page.into_iter().enumerate() {
        let mut buf = String::new();
        for r in &runs {
            let _ = write!(buf, "{}|{}|{}|{:?}|{:?};", r.text, r.x, r.y, r.path, r.start);
        }
        let h = fnv(buf.as_bytes());
        if cache.hit_hashes[i] != h {
            cache.hit_hashes[i] = h;
            delta.hits.push((i, runs));
        }
    }
    delta
}

/// Render one page of a layout to a standalone SVG string — the lazy
/// counterpart of [`render_delta`]'s change detection.
pub fn render_page_svg(layout: &rdocx::WordLayoutResult, index: usize) -> Option<String> {
    let page = layout.layout.pages.get(index)?;
    let mut renderer = SvgRenderer::new(&layout.layout.fonts);
    Some(renderer.render_page(page))
}

/// If an EMF merely wraps a single bitmap (the usual shape of scanned
/// stamps and seals embedded by Word), extract its DIB from the
/// EMR_STRETCHDIBITS record and repackage it as a BMP file browsers can
/// decode. Anything more complex (real vector metafiles) returns None.
fn emf_wrapped_bitmap(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 88 || &data[40..44] != b" EMF" {
        return None;
    }
    let u32_at = |p: usize| -> Option<usize> {
        Some(u32::from_le_bytes(data.get(p..p + 4)?.try_into().ok()?) as usize)
    };
    let mut off = 0usize;
    while off + 8 <= data.len() {
        let rec_type = u32_at(off)?;
        let rec_size = u32_at(off + 4)?;
        if rec_size < 8 || off + rec_size > data.len() {
            return None;
        }
        if rec_type == 81 {
            // EMR_STRETCHDIBITS: BMI and bits offsets are record-relative.
            let off_bmi = off + u32_at(off + 48)?;
            let cb_bmi = u32_at(off + 52)?;
            let off_bits = off + u32_at(off + 56)?;
            let cb_bits = u32_at(off + 60)?;
            let bmi = data.get(off_bmi..off_bmi + cb_bmi)?;
            let bits = data.get(off_bits..off_bits + cb_bits)?;
            let mut bmp = Vec::with_capacity(14 + bmi.len() + bits.len());
            bmp.extend_from_slice(b"BM");
            bmp.extend_from_slice(&((14 + bmi.len() + bits.len()) as u32).to_le_bytes());
            bmp.extend_from_slice(&0u32.to_le_bytes());
            bmp.extend_from_slice(&((14 + bmi.len()) as u32).to_le_bytes());
            bmp.extend_from_slice(bmi);
            bmp.extend_from_slice(bits);
            return Some(bmp);
        }
        off += rec_size;
    }
    None
}

/// Resolution of rendered run segments to their source paragraphs, via the
/// F-X037 source map. (Formerly a greedy text-matching workaround; layout
/// output now carries exact source
/// positions (the "provenance" gap): segments are matched by text, in reading
/// order, with a cursor that only moves forward. Segments that never match —
/// table cell content, list markers, headers — stay `None` and are read-only
/// to the editor layer.
/// Resolve each hit's result-local source id into a stable path string via
/// the layout bundle's F-X037 source table. Replaces the former
/// text-matching provenance bypass, which could not reach table cells.
pub fn resolve_hit_paths(hits: &mut [HitRun], layout: &rdocx::WordLayoutResult) {
    for hit in hits.iter_mut() {
        let Some(node) = hit.node else {
            continue;
        };
        let Some(path) = layout.source_node(node) else {
            continue;
        };
        hit.path = Some(format_source_path(path));
    }
}

/// Compact string form of a source path; see [`HitRun::path`].
fn format_source_path(path: &rdocx::WordSourcePath) -> String {
    let mut out = String::new();
    match &path.story {
        rdocx::WordStory::Document => out.push('d'),
        rdocx::WordStory::Header { relationship_id } => {
            let _ = write!(out, "h/{relationship_id}");
        }
        rdocx::WordStory::Footer { relationship_id } => {
            let _ = write!(out, "f/{relationship_id}");
        }
        rdocx::WordStory::Footnote { id } => {
            let _ = write!(out, "fn/{id}");
        }
        rdocx::WordStory::Endnote { id } => {
            let _ = write!(out, "en/{id}");
        }
    }
    out.push('/');
    for (i, child) in path.children.iter().enumerate() {
        if i > 0 {
            out.push('.');
        }
        let _ = write!(out, "{child}");
    }
    out
}

/// Parse the children of a Document-story hit path ("d/12", "d/12.0.1.0").
/// Non-document stories (headers, notes) return None: not editable yet.
pub fn parse_doc_path(path: &str) -> Option<Vec<usize>> {
    let rest = path.strip_prefix("d/")?;
    rest.split('.').map(|c| c.parse().ok()).collect()
}

/// An editable location parsed from a hit path: a Document-story source
/// path, or one paragraph of a header/footer part.
#[derive(Clone)]
pub enum EditPath {
    Doc(Vec<usize>),
    HeaderFooter {
        is_header: bool,
        rel_id: String,
        para: usize,
    },
    Note {
        is_footnote: bool,
        id: i32,
        para: usize,
    },
}

/// Parse any editable hit path ("d/…", "h/rId3/0", "f/rId4/0", "fn/2/0",
/// "en/3/0").
pub fn parse_edit_path(path: &str) -> Option<EditPath> {
    if let Some(children) = parse_doc_path(path) {
        return Some(EditPath::Doc(children));
    }
    if let Some(rest) = path.strip_prefix("fn/").map(|r| (true, r)).or_else(|| {
        path.strip_prefix("en/").map(|r| (false, r))
    }) {
        let (is_footnote, rest) = rest;
        let (id, para) = rest.rsplit_once('/')?;
        return Some(EditPath::Note {
            is_footnote,
            id: id.parse().ok()?,
            para: para.parse().ok()?,
        });
    }
    let (is_header, rest) = if let Some(rest) = path.strip_prefix("h/") {
        (true, rest)
    } else if let Some(rest) = path.strip_prefix("f/") {
        (false, rest)
    } else {
        return None;
    };
    let (rel_id, para) = rest.rsplit_once('/')?;
    Some(EditPath::HeaderFooter {
        is_header,
        rel_id: rel_id.to_owned(),
        para: para.parse().ok()?,
    })
}

/// Apply a paragraph-text edit at any editable location.
pub fn edit_text_at(doc: &mut Document, at: &EditPath, edit: impl Fn(&str) -> Option<String>) -> bool {
    match at {
        EditPath::Doc(children) => {
            let Some(mut p) = doc.paragraph_at_path_mut(children) else {
                return false;
            };
            apply_text_edit(&mut p, edit)
        }
        EditPath::HeaderFooter {
            is_header,
            rel_id,
            para,
        } => doc
            .with_header_footer_paragraph_mut(*is_header, rel_id, *para, |mut p| {
                apply_text_edit(&mut p, edit)
            })
            .unwrap_or(false),
        EditPath::Note {
            is_footnote: true,
            id,
            para,
        } => doc
            .with_footnote_paragraph_mut(*id, *para, |mut p| apply_text_edit(&mut p, edit))
            .unwrap_or(false),
        EditPath::Note {
            is_footnote: false,
            id,
            para,
        } => doc
            .with_endnote_paragraph_mut(*id, *para, |mut p| apply_text_edit(&mut p, edit))
            .unwrap_or(false),
    }
}

/// Delete [start, end) at any editable location.
pub fn delete_range_at(doc: &mut Document, at: &EditPath, start: usize, end: usize) -> bool {
    match at {
        EditPath::Doc(children) => delete_range_in_para_path(doc, children, start, end),
        EditPath::HeaderFooter {
            is_header,
            rel_id,
            para,
        } => doc
            .with_header_footer_paragraph_mut(*is_header, rel_id, *para, |mut p| {
                delete_range_in(&mut p, start, end)
            })
            .unwrap_or(false),
        EditPath::Note {
            is_footnote: true,
            id,
            para,
        } => doc
            .with_footnote_paragraph_mut(*id, *para, |mut p| delete_range_in(&mut p, start, end))
            .unwrap_or(false),
        EditPath::Note {
            is_footnote: false,
            id,
            para,
        } => doc
            .with_endnote_paragraph_mut(*id, *para, |mut p| delete_range_in(&mut p, start, end))
            .unwrap_or(false),
    }
}

/// Toggle bold/italic/underline at any editable location.
pub fn toggle_at(doc: &mut Document, at: &EditPath, start: usize, end: usize, fmt: char) -> bool {
    match at {
        EditPath::Doc(children) => toggle_format_path(doc, children, start, end, fmt),
        EditPath::HeaderFooter {
            is_header,
            rel_id,
            para,
        } => doc
            .with_header_footer_paragraph_mut(*is_header, rel_id, *para, |mut p| {
                toggle_in(&mut p, start, end, fmt)
            })
            .unwrap_or(false),
        EditPath::Note {
            is_footnote: true,
            id,
            para,
        } => doc
            .with_footnote_paragraph_mut(*id, *para, |mut p| toggle_in(&mut p, start, end, fmt))
            .unwrap_or(false),
        EditPath::Note {
            is_footnote: false,
            id,
            para,
        } => doc
            .with_endnote_paragraph_mut(*id, *para, |mut p| toggle_in(&mut p, start, end, fmt))
            .unwrap_or(false),
    }
}

/// Run `f` on the paragraph at any editable location (all six stories).
pub fn with_paragraph_at<R>(
    doc: &mut Document,
    at: &EditPath,
    f: impl FnOnce(&mut rdocx::Paragraph<'_>) -> R,
) -> Option<R> {
    match at {
        EditPath::Doc(children) => {
            let mut p = doc.paragraph_at_path_mut(children)?;
            Some(f(&mut p))
        }
        EditPath::HeaderFooter {
            is_header,
            rel_id,
            para,
        } => doc.with_header_footer_paragraph_mut(*is_header, rel_id, *para, |mut p| f(&mut p)),
        EditPath::Note {
            is_footnote: true,
            id,
            para,
        } => doc.with_footnote_paragraph_mut(*id, *para, |mut p| f(&mut p)),
        EditPath::Note {
            is_footnote: false,
            id,
            para,
        } => doc.with_endnote_paragraph_mut(*id, *para, |mut p| f(&mut p)),
    }
}

/// Set paragraph alignment ('l' | 'c' | 'r' | 'j') at any editable location.
pub fn set_alignment_at(doc: &mut Document, at: &EditPath, align: char) -> bool {
    let a = match align {
        'l' => rdocx::Alignment::Left,
        'c' => rdocx::Alignment::Center,
        'r' => rdocx::Alignment::Right,
        'j' => rdocx::Alignment::Justify,
        _ => return false,
    };
    with_paragraph_at(doc, at, |p| p.set_alignment(a)).is_some()
}

/// Insert text at a character offset at any editable location.
pub fn insert_text_at(doc: &mut Document, at: &EditPath, char_off: usize, s: &str) -> bool {
    edit_text_at(doc, at, |text| {
        let b = char_to_byte(text, char_off.min(text.chars().count()));
        let mut nt = String::with_capacity(text.len() + s.len());
        nt.push_str(&text[..b]);
        nt.push_str(s);
        nt.push_str(&text[b..]);
        Some(nt)
    })
}

/// Backspace at any editable location.
pub fn delete_char_at(doc: &mut Document, at: &EditPath, char_off: usize) -> bool {
    if char_off == 0 {
        return false;
    }
    edit_text_at(doc, at, |text| {
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

/// Paragraph text at any editable location.
pub fn text_at(doc: &Document, at: &EditPath) -> Option<String> {
    match at {
        EditPath::Doc(children) => doc.paragraph_text_at_path(children),
        EditPath::HeaderFooter {
            is_header,
            rel_id,
            para,
        } => doc.header_footer_paragraph_text(*is_header, rel_id, *para),
        EditPath::Note {
            is_footnote: true,
            id,
            para,
        } => doc.footnote_paragraph_text(*id, *para),
        EditPath::Note {
            is_footnote: false,
            id,
            para,
        } => doc.endnote_paragraph_text(*id, *para),
    }
}

/// paragraphs()-order index of the body paragraph at `body_index`, for the
/// order-addressed operations (split, merge, cross-paragraph ranges).
pub fn body_order_of(doc: &Document, body_index: usize) -> Option<usize> {
    let mut order = 0usize;
    for (i, item) in doc.body_items().enumerate() {
        if let rdocx::BodyItemRef::Paragraph(_) = item {
            if i == body_index {
                return Some(order);
            }
            order += 1;
        } else if i == body_index {
            return None;
        }
    }
    None
}

fn char_to_byte(s: &str, char_idx: usize) -> usize {
    s.char_indices()
        .nth(char_idx)
        .map(|(b, _)| b)
        .unwrap_or(s.len())
}

/// Insert text at a character offset within a body paragraph.
pub fn insert_at(doc: &mut Document, para: usize, char_off: usize, s: &str) -> bool {
    let Some(children) = doc.paragraph_body_index(para).map(|i| vec![i]) else {
        return false;
    };
    insert_at_path(doc, &children, char_off, s)
}

/// Insert text at a character offset in the paragraph at a Document-story
/// source path (body paragraph or table cell paragraph).
pub fn insert_at_path(doc: &mut Document, children: &[usize], char_off: usize, s: &str) -> bool {
    edit_paragraph_at(doc, children, |text| {
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
    let Some(children) = doc.paragraph_body_index(para).map(|i| vec![i]) else {
        return false;
    };
    delete_char_before_path(doc, &children, char_off)
}

/// Backspace within the paragraph at a Document-story source path.
pub fn delete_char_before_path(doc: &mut Document, children: &[usize], char_off: usize) -> bool {
    if char_off == 0 {
        return false;
    }
    edit_paragraph_at(doc, children, |text| {
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

/// Delete characters [start, end) within one paragraph by trimming each
/// overlapping run's text. Runs that become empty are left in place (no
/// public run-removal API yet — harmless to layout and to Word).
pub fn delete_range_in_para(doc: &mut Document, para: usize, start: usize, end: usize) -> bool {
    let Some(children) = doc.paragraph_body_index(para).map(|i| vec![i]) else {
        return false;
    };
    delete_range_in_para_path(doc, &children, start, end)
}

/// Delete [start, end) within the paragraph at a Document-story source path.
pub fn delete_range_in_para_path(
    doc: &mut Document,
    children: &[usize],
    start: usize,
    end: usize,
) -> bool {
    let Some(mut p) = doc.paragraph_at_path_mut(children) else {
        return false;
    };
    delete_range_in(&mut p, start, end)
}

/// Delete [start, end) inside one already-resolved paragraph.
fn delete_range_in(p: &mut rdocx::Paragraph<'_>, start: usize, end: usize) -> bool {
    if end <= start {
        return true;
    }
    let mut acc = 0usize;
    for j in 0..p.run_count() {
        let t = p.run(j).map(|r| r.text()).unwrap_or_default();
        let n = t.chars().count();
        let lo = start.max(acc);
        let hi = end.min(acc + n);
        if lo < hi {
            let b0 = char_to_byte(&t, lo - acc);
            let b1 = char_to_byte(&t, hi - acc);
            let mut nt = String::with_capacity(t.len());
            nt.push_str(&t[..b0]);
            nt.push_str(&t[b1..]);
            if let Some(mut r) = p.run_mut(j) {
                r.set_text(&nt);
            }
        }
        acc += n;
    }
    true
}

/// Direct (uninherited) run formatting, for copying across splits/merges.
#[derive(Clone, Default)]
struct RunProps {
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<i32>,
    strike: Option<bool>,
    size: Option<f64>,
    color: Option<String>,
    font: Option<String>,
}

fn snapshot_runs(doc: &Document, para: usize) -> Option<Vec<(String, RunProps)>> {
    let p = doc.paragraph(para)?;
    Some(
        p.runs()
            .map(|r| {
                (
                    r.text(),
                    RunProps {
                        bold: r.bold_value(),
                        italic: r.italic_value(),
                        underline: r.underline_code_value(),
                        strike: r.strike_value(),
                        size: r.size(),
                        color: r.color().map(str::to_owned),
                        font: r.font_name().map(str::to_owned),
                    },
                )
            })
            .collect(),
    )
}

fn apply_props(r: &mut rdocx::Run<'_>, props: &RunProps) {
    r.set_bold_value(props.bold);
    r.set_italic_value(props.italic);
    r.set_underline_code_value(props.underline);
    r.set_strike_value(props.strike);
    r.set_size_value(props.size);
    r.set_color_value(props.color.as_deref());
    r.set_font_value(props.font.as_deref());
}

/// Split a paragraph at a character offset (Enter). The tail moves into a
/// new paragraph inserted right after, carrying run formatting and the
/// paragraph's style, alignment, and numbering.
pub fn split_paragraph(doc: &mut Document, para: usize, off: usize) -> bool {
    let Some(runs) = snapshot_runs(doc, para) else {
        return false;
    };
    let Some(body_idx) = doc.paragraph_body_index(para) else {
        return false;
    };
    let (style, align, numbering) = {
        let p = doc.paragraph(para).unwrap();
        (
            p.style_id().map(str::to_owned),
            p.alignment(),
            p.numbering(),
        )
    };

    // Partition the run list at the split offset.
    let mut head: Vec<(String, RunProps)> = Vec::new();
    let mut tail: Vec<(String, RunProps)> = Vec::new();
    let mut acc = 0usize;
    for (t, props) in &runs {
        let n = t.chars().count();
        if acc + n <= off {
            head.push((t.clone(), props.clone()));
        } else if acc >= off {
            tail.push((t.clone(), props.clone()));
        } else {
            let b = char_to_byte(t, off - acc);
            head.push((t[..b].to_owned(), props.clone()));
            tail.push((t[b..].to_owned(), props.clone()));
        }
        acc += n;
    }

    // Truncate the original paragraph to the head texts.
    {
        let Some(mut p) = doc.paragraph_mut(para) else {
            return false;
        };
        for j in 0..p.run_count() {
            let nt = head.get(j).map(|(t, _)| t.as_str()).unwrap_or("");
            if let Some(mut r) = p.run_mut(j) {
                r.set_text(nt);
            }
        }
    }

    // New paragraph with the tail, same paragraph-level formatting.
    let mut np = doc.insert_paragraph(body_idx + 1, "");
    if let Some(s) = &style {
        np.set_style(s);
    }
    if let Some(a) = align {
        np.set_alignment(a);
    }
    if let Some((num, lvl)) = numbering {
        np.set_numbering(num, lvl);
    }
    for (t, props) in &tail {
        let mut r = np.add_run(t);
        apply_props(&mut r, props);
    }
    true
}

/// Merge paragraph `para` into the previous one (Backspace at offset 0).
pub fn merge_paragraph_into_prev(doc: &mut Document, para: usize) -> bool {
    if para == 0 {
        return false;
    }
    let Some(runs) = snapshot_runs(doc, para) else {
        return false;
    };
    let Some(body_idx) = doc.paragraph_body_index(para) else {
        return false;
    };
    {
        let Some(mut prev) = doc.paragraph_mut(para - 1) else {
            return false;
        };
        for (t, props) in &runs {
            if t.is_empty() {
                continue;
            }
            let mut r = prev.add_run(t);
            apply_props(&mut r, props);
        }
    }
    doc.remove_content(body_idx)
}

/// Delete an arbitrary (possibly cross-paragraph) range.
pub fn delete_range(
    doc: &mut Document,
    pa: usize,
    oa: usize,
    pb: usize,
    ob: usize,
) -> bool {
    if pa == pb {
        return delete_range_in_para(doc, pa, oa, ob);
    }
    if pb < pa {
        return false;
    }
    let tail_len = doc
        .paragraph(pa)
        .map(|p| p.text().chars().count())
        .unwrap_or(0);
    if !delete_range_in_para(doc, pa, oa, tail_len) {
        return false;
    }
    if !delete_range_in_para(doc, pb, 0, ob) {
        return false;
    }
    // Remove the fully covered middle paragraphs, then merge what is left
    // of pb into pa. Paragraph indices shift as we remove, so always remove
    // at pa + 1.
    for _ in 0..pb - pa - 1 {
        let Some(bi) = doc.paragraph_body_index(pa + 1) else {
            return false;
        };
        if !doc.remove_content(bi) {
            return false;
        }
    }
    merge_paragraph_into_prev(doc, pa + 1)
}

/// Container identity + sibling index of an editable path. Two paths that
/// share the container key are sibling paragraphs whose document order is
/// the index (body content index, cell content index, or note/part
/// paragraph index).
pub fn sibling_locus(at: &EditPath) -> (String, usize) {
    match at {
        EditPath::Doc(children) => {
            let (last, prefix) = children.split_last().expect("doc paths are non-empty");
            (format!("d:{prefix:?}"), *last)
        }
        EditPath::HeaderFooter {
            is_header,
            rel_id,
            para,
        } => (
            format!("{}:{rel_id}", if *is_header { "h" } else { "f" }),
            *para,
        ),
        EditPath::Note {
            is_footnote,
            id,
            para,
        } => (
            format!("{}:{id}", if *is_footnote { "fn" } else { "en" }),
            *para,
        ),
    }
}

/// The sibling of `at` with the given index in the same container.
pub fn at_sibling(at: &EditPath, idx: usize) -> EditPath {
    match at {
        EditPath::Doc(children) => {
            let mut c = children.clone();
            *c.last_mut().expect("doc paths are non-empty") = idx;
            EditPath::Doc(c)
        }
        EditPath::HeaderFooter {
            is_header, rel_id, ..
        } => EditPath::HeaderFooter {
            is_header: *is_header,
            rel_id: rel_id.clone(),
            para: idx,
        },
        EditPath::Note {
            is_footnote, id, ..
        } => EditPath::Note {
            is_footnote: *is_footnote,
            id: *id,
            para: idx,
        },
    }
}

/// Split the paragraph at `at` at a char offset (Enter), in any story.
/// The tail becomes the next sibling.
pub fn split_at(doc: &mut Document, at: &EditPath, char_off: usize) -> bool {
    match at {
        EditPath::Doc(children) => doc.split_paragraph_at_path(children, char_off),
        EditPath::HeaderFooter {
            is_header,
            rel_id,
            para,
        } => doc.split_header_footer_paragraph(*is_header, rel_id, *para, char_off),
        EditPath::Note {
            is_footnote: true,
            id,
            para,
        } => doc.split_footnote_paragraph(*id, *para, char_off),
        EditPath::Note {
            is_footnote: false,
            id,
            para,
        } => doc.split_endnote_paragraph(*id, *para, char_off),
    }
}

/// Merge the paragraph at `at` into its previous sibling, in any story.
pub fn merge_at(doc: &mut Document, at: &EditPath) -> bool {
    match at {
        EditPath::Doc(children) => doc.merge_paragraph_at_path(children),
        EditPath::HeaderFooter {
            is_header,
            rel_id,
            para,
        } => doc.merge_header_footer_paragraph(*is_header, rel_id, *para),
        EditPath::Note {
            is_footnote: true,
            id,
            para,
        } => doc.merge_footnote_paragraph(*id, *para),
        EditPath::Note {
            is_footnote: false,
            id,
            para,
        } => doc.merge_endnote_paragraph(*id, *para),
    }
}

/// Note references (footnote/endnote) that a deletion range covers in the
/// paragraph at a Document-story path, as `(is_footnote, id)`. `after` and
/// `before` bound the reference's char position exclusively on either side
/// (None = unbounded). Non-body stories cannot carry references.
pub fn covered_note_refs(
    doc: &mut Document,
    at: &EditPath,
    after: Option<usize>,
    before: Option<usize>,
) -> Vec<(bool, i32)> {
    let EditPath::Doc(children) = at else {
        return Vec::new();
    };
    let Some(p) = doc.paragraph_at_path_mut(children) else {
        return Vec::new();
    };
    p.note_refs()
        .into_iter()
        .filter(|(_, _, pos)| {
            after.map_or(true, |a| *pos > a) && before.map_or(true, |b| *pos < b)
        })
        .map(|(is_footnote, id, _)| (is_footnote, id))
        .collect()
}

/// Remove the given notes along with every reference marker pointing at
/// them (Word deletes the note when its reference is inside a deleted
/// selection). Ids are expected deduplicated.
pub fn remove_notes(doc: &mut Document, notes: &[(bool, i32)]) -> bool {
    notes.iter().all(|(is_footnote, id)| {
        if *is_footnote {
            doc.remove_footnote(*id)
        } else {
            doc.remove_endnote(*id)
        }
    })
}

/// Word-style deletion across sibling paragraphs of one container (body,
/// table cell, header/footer, footnote, endnote): trim the head paragraph's
/// tail and the tail paragraph's head, clear fully covered middles, then
/// merge everything into the head paragraph. Fails atomically (staged doc
/// is discarded) when the container keys differ or any sibling in between
/// is not a plain paragraph — e.g. a body selection spanning a table.
pub fn delete_range_across(
    doc: &mut Document,
    at_a: &EditPath,
    oa: usize,
    at_b: &EditPath,
    ob: usize,
) -> bool {
    let (ka, ia) = sibling_locus(at_a);
    let (kb, ib) = sibling_locus(at_b);
    if ka != kb || ib <= ia {
        return false;
    }
    // Top-level body ranges may have whole tables between the endpoints;
    // Word deletes those with the selection, so they take a separate route
    // that removes middle contents outright instead of clearing paragraphs.
    let body_top = matches!((at_a, at_b), (EditPath::Doc(a), EditPath::Doc(b))
        if a.len() == 1 && b.len() == 1);
    // Notes whose reference marker falls inside the range go first (their
    // reference runs carry no text, so char offsets are unaffected).
    let mut doomed: Vec<(bool, i32)> = Vec::new();
    let collect = |v: Vec<(bool, i32)>, doomed: &mut Vec<(bool, i32)>| {
        for x in v {
            if !doomed.contains(&x) {
                doomed.push(x);
            }
        }
    };
    collect(covered_note_refs(doc, at_a, Some(oa), None), &mut doomed);
    for i in ia + 1..ib {
        if body_top {
            collect(doc.note_refs_in_content(i), &mut doomed);
        } else {
            collect(
                covered_note_refs(doc, &at_sibling(at_a, i), None, None),
                &mut doomed,
            );
        }
    }
    collect(covered_note_refs(doc, at_b, None, Some(ob)), &mut doomed);
    if !remove_notes(doc, &doomed) {
        return false;
    }
    if body_top {
        let Some(len_a) = text_at(doc, at_a).map(|t| t.chars().count()) else {
            return false;
        };
        if !delete_range_at(doc, at_a, oa.min(len_a), len_a) {
            return false;
        }
        if !delete_range_at(doc, at_b, 0, ob) {
            return false;
        }
        // Remove everything between the endpoints — paragraphs and whole
        // tables alike — then merge the trimmed tail into the head.
        for _ in ia + 1..ib {
            if !doc.remove_content(ia + 1) {
                return false;
            }
        }
        return merge_at(doc, &at_sibling(at_a, ia + 1));
    }
    let Some(len_a) = text_at(doc, at_a).map(|t| t.chars().count()) else {
        return false;
    };
    if !delete_range_at(doc, at_a, oa.min(len_a), len_a) {
        return false;
    }
    for i in ia + 1..ib {
        let mid = at_sibling(at_a, i);
        let Some(len) = text_at(doc, &mid).map(|t| t.chars().count()) else {
            return false;
        };
        if !delete_range_at(doc, &mid, 0, len) {
            return false;
        }
    }
    if !delete_range_at(doc, at_b, 0, ob) {
        return false;
    }
    for _ in ia..ib {
        if !merge_at(doc, &at_sibling(at_a, ia + 1)) {
            return false;
        }
    }
    true
}

/// Locate the run index and run-local offset for a paragraph-level offset.
fn locate(p: &rdocx::Paragraph<'_>, off: usize) -> (usize, usize) {
    let mut acc = 0usize;
    let n = p.run_count();
    for j in 0..n {
        let len = p.run(j).map(|r| r.text().chars().count()).unwrap_or(0);
        if off < acc + len {
            return (j, off - acc);
        }
        acc += len;
    }
    (n.saturating_sub(1), off.saturating_sub(acc))
}

/// Toggle bold/italic/underline over [start, end) in one paragraph.
/// Word semantics: if every covered run already has the format, clear it,
/// otherwise set it. Runs are split at the range boundaries first.
pub fn toggle_format(
    doc: &mut Document,
    para: usize,
    start: usize,
    end: usize,
    fmt: char,
) -> bool {
    let Some(children) = doc.paragraph_body_index(para).map(|i| vec![i]) else {
        return false;
    };
    toggle_format_path(doc, &children, start, end, fmt)
}

/// Toggle bold/italic/underline over [start, end) in the paragraph at a
/// Document-story source path.
pub fn toggle_format_path(
    doc: &mut Document,
    children: &[usize],
    start: usize,
    end: usize,
    fmt: char,
) -> bool {
    let Some(mut p) = doc.paragraph_at_path_mut(children) else {
        return false;
    };
    toggle_in(&mut p, start, end, fmt)
}

/// Toggle a format over [start, end) inside one already-resolved paragraph.
/// Whether every run overlapping [start, end) already carries the format —
/// the read half of Word's toggle semantics, computed without mutating.
fn format_all_on_in(p: &rdocx::Paragraph<'_>, start: usize, end: usize, fmt: char) -> Option<bool> {
    let mut acc = 0usize;
    let mut any = false;
    for j in 0..p.run_count() {
        let r = p.run(j)?;
        let len = r.text().chars().count();
        if start.max(acc) < end.min(acc + len) {
            any = true;
            let on = match fmt {
                'b' => r.is_bold(),
                'i' => r.is_italic(),
                'u' => r.is_underline(),
                _ => return None,
            };
            if !on {
                return Some(false);
            }
        }
        acc += len;
    }
    any.then_some(true)
}

/// Read `format_all_on_in` at any editable location.
pub fn format_all_on_at(
    doc: &mut Document,
    at: &EditPath,
    start: usize,
    end: usize,
    fmt: char,
) -> Option<bool> {
    with_paragraph_at(doc, at, |p| format_all_on_in(p, start, end, fmt)).flatten()
}

/// Set (not toggle) a format over [start, end) of one paragraph, splitting
/// runs at the range boundaries like toggle_in.
fn set_format_in(p: &mut rdocx::Paragraph<'_>, start: usize, end: usize, fmt: char, on: bool) -> bool {
    if end <= start {
        return false;
    }
    let (j2, o2) = locate(p, end);
    p.split_run(j2, o2);
    let (j1, o1) = locate(p, start);
    p.split_run(j1, o1);
    let mut acc = 0usize;
    let mut any = false;
    for j in 0..p.run_count() {
        let len = p.run(j).map(|r| r.text().chars().count()).unwrap_or(0);
        if len > 0 && acc >= start && acc + len <= end {
            any = true;
            if let Some(mut r) = p.run_mut(j) {
                match fmt {
                    'b' => r.set_bold(on),
                    'i' => r.set_italic(on),
                    'u' => r.set_underline(on),
                    _ => return false,
                }
            }
        }
        acc += len;
    }
    any
}

/// Set a format over [start, end) at any editable location.
pub fn set_format_at(
    doc: &mut Document,
    at: &EditPath,
    start: usize,
    end: usize,
    fmt: char,
    on: bool,
) -> bool {
    with_paragraph_at(doc, at, |p| set_format_in(p, start, end, fmt, on)).unwrap_or(false)
}

/// Set the font size (pt) over [start, end) of one paragraph, splitting
/// runs at the range boundaries the same way toggle_in does.
fn set_size_in(p: &mut rdocx::Paragraph<'_>, start: usize, end: usize, pt: f64) -> bool {
    if end <= start || !(1.0..=1638.0).contains(&pt) {
        return false;
    }
    let (j2, o2) = locate(p, end);
    p.split_run(j2, o2);
    let (j1, o1) = locate(p, start);
    p.split_run(j1, o1);
    let mut covered: Vec<usize> = Vec::new();
    let mut acc = 0usize;
    for j in 0..p.run_count() {
        let len = p.run(j).map(|r| r.text().chars().count()).unwrap_or(0);
        if len > 0 && acc >= start && acc + len <= end {
            covered.push(j);
        }
        acc += len;
    }
    if covered.is_empty() {
        return false;
    }
    for &j in &covered {
        if let Some(mut r) = p.run_mut(j) {
            r.set_size(pt);
        }
    }
    true
}

/// Set the font size over [start, end) at any editable location.
pub fn set_size_at(doc: &mut Document, at: &EditPath, start: usize, end: usize, pt: f64) -> bool {
    with_paragraph_at(doc, at, |p| set_size_in(p, start, end, pt)).unwrap_or(false)
}

/// Set the paragraph style (e.g. "Normal", "Heading1") at any editable
/// location.
pub fn set_style_at(doc: &mut Document, at: &EditPath, style_id: &str) -> bool {
    with_paragraph_at(doc, at, |p| p.set_style(style_id)).is_some()
}

/// Set the text color (6-digit hex, no '#') over [start, end) of one
/// paragraph, splitting runs at the range boundaries like set_size_in.
fn set_color_in(p: &mut rdocx::Paragraph<'_>, start: usize, end: usize, hex: &str) -> bool {
    if end <= start || hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return false;
    }
    let (j2, o2) = locate(p, end);
    p.split_run(j2, o2);
    let (j1, o1) = locate(p, start);
    p.split_run(j1, o1);
    let mut acc = 0usize;
    let mut any = false;
    for j in 0..p.run_count() {
        let len = p.run(j).map(|r| r.text().chars().count()).unwrap_or(0);
        if len > 0 && acc >= start && acc + len <= end {
            any = true;
            if let Some(mut r) = p.run_mut(j) {
                r.set_color(hex);
            }
        }
        acc += len;
    }
    any
}

/// Set the text color over [start, end) at any editable location.
pub fn set_color_at(doc: &mut Document, at: &EditPath, start: usize, end: usize, hex: &str) -> bool {
    with_paragraph_at(doc, at, |p| set_color_in(p, start, end, hex)).unwrap_or(false)
}

fn toggle_in(p: &mut rdocx::Paragraph<'_>, start: usize, end: usize, fmt: char) -> bool {
    if end <= start {
        return false;
    }
    // Split at the end boundary first so earlier indices stay valid.
    let (j2, o2) = locate(&p, end);
    p.split_run(j2, o2);
    let (j1, o1) = locate(&p, start);
    p.split_run(j1, o1);

    // Collect the runs fully inside the range.
    let mut covered: Vec<usize> = Vec::new();
    let mut acc = 0usize;
    for j in 0..p.run_count() {
        let len = p.run(j).map(|r| r.text().chars().count()).unwrap_or(0);
        if len > 0 && acc >= start && acc + len <= end {
            covered.push(j);
        }
        acc += len;
    }
    if covered.is_empty() {
        return false;
    }
    let all_on = covered.iter().all(|&j| {
        p.run(j)
            .map(|r| match fmt {
                'b' => r.is_bold(),
                'i' => r.is_italic(),
                'u' => r.is_underline(),
                _ => false,
            })
            .unwrap_or(false)
    });
    let target = !all_on;
    for &j in &covered {
        if let Some(mut r) = p.run_mut(j) {
            match fmt {
                'b' => r.set_bold(target),
                'i' => r.set_italic(target),
                'u' => r.set_underline(target),
                _ => return false,
            }
        }
    }
    true
}

/// Apply a text edit to the run containing the paragraph-level offset.
/// The closure sees the paragraph's full text with the offset already
/// paragraph-relative; internally the edit is routed to the owning run.
fn edit_paragraph_at(
    doc: &mut Document,
    children: &[usize],
    edit: impl Fn(&str) -> Option<String>,
) -> bool {
    let Some(mut p) = doc.paragraph_at_path_mut(children) else {
        return false;
    };
    apply_text_edit(&mut p, edit)
}

/// Apply a whole-paragraph text edit inside one already-resolved paragraph.
fn apply_text_edit(p: &mut rdocx::Paragraph<'_>, edit: impl Fn(&str) -> Option<String>) -> bool {
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
        // Text typed into an empty paragraph takes the paragraph mark's run
        // properties (Word behavior) — form cells keep their designed size.
        p.add_run_inheriting_mark(&new_full);
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
