//! S3 baseline: how far is full relayout-per-keystroke from the <30ms gate
//! on a ~50-page document? Generates out/bench.docx for the browser test.

use std::fmt::Write as _;
use std::time::Instant;

use rdoc_core::{EditPath, delete_range_across, insert_at, render_with_hits};

fn main() {
    let mut doc = rdocx::Document::new();
    // RDOCX_BENCH_HF=1 adds the common header + "Page N" footer, so the
    // per-key cost of header/footer layout and per-page field substitution
    // is visible; default off to keep numbers comparable with history.
    if std::env::var("RDOCX_BENCH_HF").is_ok() {
        doc.set_header("Relayout benchmark — draft");
        doc.set_footer_page_number("Page ");
    }
    doc.add_paragraph("Relayout benchmark").style("Heading1");
    for i in 0..700 {
        let mut text = String::new();
        let _ = write!(
            text,
            "Paragraph {i}: the quick brown fox jumps over the lazy dog, \
             pack my box with five dozen liquor jugs, and 한글 조판 성능 \
             측정을 위한 혼합 문장이 이어집니다. Sphinx of black quartz, \
             judge my vow across line breaks and pages."
        );
        doc.add_paragraph(&text);
        if i % 50 == 25 {
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

    let t = Instant::now();
    let layout = doc.layout().expect("layout");
    let cold = t.elapsed().as_secs_f64() * 1000.0;
    let pages = layout.layout.pages.len();

    let t = Instant::now();
    let (svgs, hits) = render_with_hits(&layout);
    let render_ms = t.elapsed().as_secs_f64() * 1000.0;
    let svg_mb = svgs.iter().map(String::len).sum::<usize>() as f64 / 1e6;
    drop(layout);

    // Keystroke simulation: mutate mid-document, then relayout (the cache is
    // invalidated by the mutation, so this is the editor's per-key cost).
    let mut keystroke = Vec::new();
    for k in 0..10 {
        assert!(insert_at(&mut doc, 350, 10 + k, "x"));
        let t = Instant::now();
        let _ = doc.layout().expect("layout");
        keystroke.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    let mean = keystroke.iter().sum::<f64>() / keystroke.len() as f64;
    let min = keystroke.iter().cloned().fold(f64::MAX, f64::min);

    // Structural ops (S7+): these change the source node table, so the
    // pagination cache falls back to a full pass — the interesting number is
    // how far that fallback is from the typing fast path. Each op runs at
    // three locations; the layout after each is what the editor would pay.
    fn op(
        doc: &mut rdocx::Document,
        name: &str,
        f: &mut dyn FnMut(&mut rdocx::Document, usize) -> bool,
    ) {
        let mut ms = Vec::new();
        for &at in &[200usize, 400, 600] {
            assert!(f(doc, at), "{name} failed at {at}");
            let t = Instant::now();
            let _ = doc.layout().expect("layout");
            ms.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        println!("{name}: {:.0} / {:.0} / {:.0} ms", ms[0], ms[1], ms[2]);
    }
    op(&mut doc, "Enter (split)", &mut |d, at| {
        d.split_paragraph_at_path(&[at], 20)
    });
    op(&mut doc, "Backspace merge", &mut |d, at| {
        d.merge_paragraph_at_path(&[at + 1])
    });
    op(&mut doc, "selection delete across 2 paragraphs", &mut |d, at| {
        delete_range_across(
            d,
            &EditPath::Doc(vec![at]),
            10,
            &EditPath::Doc(vec![at + 1]),
            10,
        )
    });
    op(&mut doc, "insert footnote", &mut |d, at| {
        d.insert_footnote_ref_at(&[at], 5).is_some()
    });
    let last_note = doc.footnotes().last().map(|(id, _)| *id).unwrap();
    let mut note_ids = vec![last_note - 2, last_note - 1, last_note];
    op(&mut doc, "delete footnote", &mut |d, _| {
        d.remove_footnote(note_ids.pop().unwrap())
    });

    println!("pages: {pages}, hit runs: {}", hits.len());
    println!("cold layout: {cold:.0} ms");
    println!("full re-layout per keystroke: mean {mean:.0} ms, min {min:.0} ms (n=10)");
    println!("render all pages to SVG: {render_ms:.0} ms, total {svg_mb:.1} MB");

    std::fs::create_dir_all("out").unwrap();
    let mut doc2 = doc;
    std::fs::write("out/bench.docx", doc2.to_bytes().expect("to_bytes")).unwrap();
    println!("wrote out/bench.docx");
}
