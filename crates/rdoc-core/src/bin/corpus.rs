//! Corpus runner: parse, lay out, and SVG-render every .docx in corpus/,
//! recording stability and coverage numbers. Panics in any stage are caught
//! so one bad file cannot hide results for the rest.

use std::fs;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::time::Instant;

use rdoc_core::render_with_hits;

fn main() {
    let out_root = std::path::Path::new("out/corpus");
    fs::create_dir_all(out_root).expect("create out dir");

    let dir = std::env::args().nth(1).unwrap_or_else(|| "corpus".to_string());
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .expect("corpus directory")
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "docx"))
        .collect();
    entries.sort();

    println!(
        "{:<28} {:>5} {:>6} {:>7} {:>8} {:>9} {:>6}  status",
        "file", "pages", "runs", "mapped", "warns", "layout", "svg KB"
    );
    let mut failures = 0usize;
    for path in &entries {
        let name = path.file_stem().unwrap().to_string_lossy().to_string();
        let result = catch_unwind(AssertUnwindSafe(|| run_one(path, out_root, &name)));
        match result {
            Ok(Ok(row)) => println!("{row}"),
            Ok(Err(e)) => {
                failures += 1;
                println!("{name:<28} {:>62}", format!("ERROR: {e}"));
            }
            Err(_) => {
                failures += 1;
                println!("{name:<28} {:>62}", "PANIC");
            }
        }
    }
    println!(
        "\n{} file(s), {} failure(s)",
        entries.len(),
        failures
    );
    std::process::exit(if failures > 0 { 1 } else { 0 });
}

fn run_one(
    path: &std::path::Path,
    out_root: &std::path::Path,
    name: &str,
) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let doc = rdocx::Document::from_bytes(&bytes).map_err(|e| format!("parse: {e}"))?;

    let t = Instant::now();
    let layout = doc.layout().map_err(|e| format!("layout: {e}"))?;
    let layout_ms = t.elapsed().as_secs_f64() * 1000.0;

    let (svgs, hits) = render_with_hits(&layout);
    let mapped = hits.iter().filter(|h| h.path.is_some()).count();
    let svg_bytes: usize = svgs.iter().map(String::len).sum();

    let dir = out_root.join(name);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for (i, svg) in svgs.iter().enumerate() {
        fs::write(dir.join(format!("page-{}.svg", i + 1)), svg).map_err(|e| e.to_string())?;
    }
    // Reference PNG of page 1 from rdocx's own raster backend.
    if let Ok(Some(png)) = doc.render_page_to_png(0, 120.0) {
        let _ = fs::write(dir.join("page-1.ref.png"), png);
    }

    Ok(format!(
        "{name:<28} {:>5} {:>6} {:>7} {:>8} {:>7.0}ms {:>6}  ok",
        layout.layout.pages.len(),
        hits.len(),
        mapped,
        layout.layout.diagnostics.len(),
        layout_ms,
        svg_bytes / 1024,
    ))
}
