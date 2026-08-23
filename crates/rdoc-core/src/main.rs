//! Native PoC driver: build the demo DOCX, lay it out with system fonts,
//! write per-page SVGs plus rdocx's own PNG renders for comparison.

use std::fmt::Write as _;
use std::fs;

use rdoc_core::{build_demo_doc, render_with_hits};

fn main() {
    let out_dir = std::path::Path::new("out");
    fs::create_dir_all(out_dir).expect("create out dir");

    let mut doc = build_demo_doc();
    doc.save(out_dir.join("demo.docx"))
        .expect("save demo.docx");

    let layout = doc.layout().expect("layout");
    println!(
        "layout: {} page(s), {} font(s), {} diagnostic(s)",
        layout.layout.pages.len(),
        layout.layout.fonts.len(),
        layout.layout.diagnostics.len()
    );
    for d in &layout.layout.diagnostics {
        println!("  diagnostic: {}", d.message);
    }

    let (svgs, hits) = render_with_hits(&layout);
    for (i, svg) in svgs.iter().enumerate() {
        let path = out_dir.join(format!("page-{}.svg", i + 1));
        fs::write(&path, svg).expect("write svg");
        println!("wrote {} ({} KB)", path.display(), svg.len() / 1024);
    }

    // Provenance mapping coverage: how many rendered segments trace back to a
    // body paragraph (the rest need real source positions from upstream).
    let mapped = hits.iter().filter(|h| h.path.is_some()).count();
    println!(
        "hit runs: {} total, {} mapped to paragraphs, {} unmapped",
        hits.len(),
        mapped,
        hits.len() - mapped
    );
    for h in hits.iter().take(6) {
        println!(
            "  #{} page {} para {:?} start {:?} {:?}",
            h.id, h.page, h.path, h.start, h.text
        );
    }
    for h in hits.iter().filter(|h| h.path.is_none()).take(6) {
        println!("  unmapped: #{} {:?}", h.id, h.text);
    }
    fs::write(
        out_dir.join("hits.json"),
        serde_json::to_string_pretty(&hits).unwrap(),
    )
    .expect("write hits.json");

    // Reference rasters from rdocx's own PNG backend, for fidelity comparison.
    let pngs = doc.render_all_pages(120.0).expect("render reference PNGs");
    for (i, png) in pngs.iter().enumerate() {
        fs::write(out_dir.join(format!("page-{}.ref.png", i + 1)), png).expect("write png");
    }

    // PDF from the same layout the SVGs came from.
    let pdf = oxml_pdf::render_to_pdf(&layout.layout);
    fs::write(out_dir.join("poc.pdf"), &pdf).expect("write pdf");
    println!("wrote {} ({} bytes)", out_dir.join("poc.pdf").display(), pdf.len());

    write_index(out_dir, layout.layout.pages.len());
    println!("wrote {}", out_dir.join("index.html").display());
}

fn write_index(out_dir: &std::path::Path, pages: usize) {
    let mut html = String::from(
        "<!doctype html><meta charset=\"utf-8\"><title>rdocx SVG PoC</title>\n\
         <style>body{font-family:sans-serif;background:#555;margin:20px}\n\
         .pair{display:flex;gap:16px;margin-bottom:24px;align-items:flex-start}\n\
         .pair>div{background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.4)}\n\
         img,object{display:block;width:612px}h2,figcaption{color:#eee}</style>\n\
         <h2>left: SVG backend (PoC) &nbsp;|&nbsp; right: rdocx PNG backend (reference)</h2>\n",
    );
    for p in 1..=pages {
        let _ = write!(
            html,
            "<div class=\"pair\"><div><object data=\"page-{p}.svg\" type=\"image/svg+xml\"></object></div>\
             <div><img src=\"page-{p}.ref.png\"></div></div>\n"
        );
    }
    fs::write(out_dir.join("index.html"), html).expect("write index.html");
}
