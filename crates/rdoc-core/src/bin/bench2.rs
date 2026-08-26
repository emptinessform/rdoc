//! S56 control: isolate upstream v0.10.1's restart-pagination eligibility gate.
//!
//! v0.10.1 `rdocx-layout/src/engine.rs` turns restart pagination off for the
//! WHOLE document unless every one of these holds: one section, no footnotes,
//! no endnotes, no header/footer, no wraps, every table cache-safe, and every
//! paragraph "restart safe" — which requires `paragraph.lines.len() <= 2`.
//!
//! Variants (env), so one build measures the 2x2 that isolates the line-count
//! condition from the table condition:
//!   RDOC_BENCH2_LONG=1    long (4-line) paragraphs instead of 1-line ones
//!   RDOC_BENCH2_TABLES=1  add the same 14 3x3 tables the S3 bench uses
//!   RDOC_BENCH2_HEADING=1 prepend ONE Heading1 paragraph and nothing else
//!                         (restart_record_block_is_safe wants heading_level
//!                          to be none on EVERY block, so one heading should
//!                          disqualify the whole document)
//! Default (neither) satisfies the gate.
use std::fmt::Write as _;
use std::time::Instant;

use rdoc_core::insert_at;

fn main() {
    let long = std::env::var("RDOC_BENCH2_LONG").is_ok();
    let tables = std::env::var("RDOC_BENCH2_TABLES").is_ok();
    let heading = std::env::var("RDOC_BENCH2_HEADING").is_ok();
    // ONE footnote anywhere: `input.footnotes.is_none()` is an explicit
    // condition of v0.10.1's document-global restart eligibility.
    let notes = std::env::var("RDOC_BENCH2_NOTES").is_ok();
    // A header/footer: `sections[0].header_footer.is_none()` is another
    // explicit condition of the same document-global eligibility test.
    let hf = std::env::var("RDOC_BENCH2_HF").is_ok();
    // Paragraph COUNT, to vary page count while holding paragraph length
    // fixed. v0.10.1 only publishes its restart cache when
    // `pages.max(checkpoints) <= RESTART_CACHE_MAX_ENTRIES` (32).
    let paras: usize = std::env::var("RDOC_BENCH2_PARAS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(700);

    let mut doc = rdocx::Document::new();
    if hf {
        doc.set_header("Relayout benchmark — draft");
        doc.set_footer_page_number("Page ");
    }
    if heading {
        doc.add_paragraph("Relayout benchmark").style("Heading1");
    }
    for i in 0..paras {
        if long {
            // Same paragraph body as the S3 bench: wraps to ~4 lines.
            let mut text = String::new();
            let _ = write!(
                text,
                "Paragraph {i}: the quick brown fox jumps over the lazy dog, \
                 pack my box with five dozen liquor jugs, and 한글 조판 성능 \
                 측정을 위한 혼합 문장이 이어집니다. Sphinx of black quartz, \
                 judge my vow across line breaks and pages."
            );
            doc.add_paragraph(&text);
        } else {
            doc.add_paragraph(&format!("Paragraph {i} short line."));
        }
        if tables && i % 50 == 25 {
            let mut t = doc.add_table(3, 3);
            for r in 0..3 {
                for c in 0..3 {
                    if let Some(mut cell) = t.cell(r, c) {
                        cell.set_text(&format!("cell {r},{c} of table {i}"));
                    }
                }
            }
        }
    }

    if notes {
        assert!(
            doc.insert_footnote_ref_at(&[10], 5).is_some(),
            "footnote insert failed"
        );
    }

    let t = Instant::now();
    let layout = doc.layout().expect("layout");
    let cold = t.elapsed().as_secs_f64() * 1000.0;
    let pages = layout.layout.pages.len();
    drop(layout);

    let mut keystroke = Vec::new();
    for k in 0..10 {
        assert!(insert_at(&mut doc, paras / 2, 10 + k, "x"));
        let t = Instant::now();
        let _ = doc.layout().expect("layout");
        keystroke.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    let mean = keystroke.iter().sum::<f64>() / keystroke.len() as f64;
    let min = keystroke.iter().cloned().fold(f64::MAX, f64::min);
    println!(
        "variant: n={} paragraphs={} tables={} heading={} notes={} hf={}",
        paras,
        if long { "long(4-line)" } else { "short(1-line)" },
        if tables { 14 } else { 0 },
        if heading { 1 } else { 0 },
        if notes { 1 } else { 0 },
        if hf { 1 } else { 0 }
    );
    println!("pages: {pages}, cold layout: {cold:.0} ms");
    println!("relayout per keystroke: mean {mean:.0} ms, min {min:.0} ms (n=10)");
}
