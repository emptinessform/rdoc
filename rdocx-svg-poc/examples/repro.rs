//! Minimal repro for the upstream glyph-duplication issue, exactly as the
//! bug report states it. Uses only stock rdocx APIs (no PoC patches).

use rdocx::Document;

fn main() {
    let mut doc = Document::new();
    doc.add_paragraph("Glyph outlines extracted with ttf-parser");
    doc.add_paragraph("(shaping, line breaking, pagination) and rendered");
    let png = doc
        .render_page_to_png(0, 150.0)
        .expect("layout")
        .expect("page 0 exists");
    std::fs::write("out/repro.png", png).expect("write png");
    println!("wrote out/repro.png");
}
