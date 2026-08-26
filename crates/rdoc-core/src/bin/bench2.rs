//! S56 control: isolate upstream v0.10.1's restart-pagination eligibility gate.
//!
//! v0.10.1 `rdocx-layout::engine` turns restart pagination off for the WHOLE
//! document unless every one of these holds:
//!   sections == 1, no footnotes, no endnotes, no header/footer, no wraps,
//!   and every paragraph block is "restart safe" — which requires
//!   `paragraph.lines.len() <= 2`.
//! The S3 bench document violates three of those (4-line paragraphs, tables,
//! and later footnotes), so it never takes the incremental path.
//!
//! This bench builds the SAME paragraph count with SHORT (1-line) paragraphs
//! and nothing else, so the gate is satisfied. Run it on both pins: if the
//! 0.8-vs-0.10.1 gap collapses here but not in `bench`, the gate is the cause.
use std::time::Instant;

use rdoc_core::insert_at;

fn main() {
    let mut doc = rdocx::Document::new();
    for i in 0..700 {
        // Short enough to stay on one line at the default page width.
        doc.add_paragraph(&format!("Paragraph {i} short line."));
    }

    let t = Instant::now();
    let layout = doc.layout().expect("layout");
    let cold = t.elapsed().as_secs_f64() * 1000.0;
    println!("pages: {}", layout.layout.pages.len());
    drop(layout);

    let mut keystroke = Vec::new();
    for k in 0..10 {
        assert!(insert_at(&mut doc, 350, 10 + k, "x"));
        let t = Instant::now();
        let _ = doc.layout().expect("layout");
        keystroke.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    let mean = keystroke.iter().sum::<f64>() / keystroke.len() as f64;
    let min = keystroke.iter().cloned().fold(f64::MAX, f64::min);
    println!("cold layout: {cold:.0} ms");
    println!("short-paragraph relayout per keystroke: mean {mean:.0} ms, min {min:.0} ms (n=10)");
}
