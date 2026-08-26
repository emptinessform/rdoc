//! S56c: reproduce the BROWSER layout path natively.
//!
//! `bench`/`bench2` call `Document::layout()`, which takes no caller fonts.
//! The wasm editor instead calls
//! `layout_with_fonts_aliases_and_bundled_fallback[_and_options]` with the
//! real open-font set and ~40 byte-free aliases on every keystroke. The
//! browser A/B showed a regression that the native benches do not, so this
//! harness isolates the difference without a browser.
//!
//! Env:
//!   RDOC_BENCH3_FONTS=0    register no caller fonts (isolates the font path)
//!   RDOC_BENCH3_ALIASES=0  register no aliases (isolates alias resolution)
//!   RDOC_BENCH3_PARAS=N    paragraph count (default 700, ~63 pages)
use std::fmt::Write as _;
use std::time::Instant;

use rdoc_core::insert_at;

const SANS_ALIASES: &[&str] = &[
    "맑은 고딕 Semilight", "굴림", "Gulim", "굴림체", "GulimChe", "돋움", "Dotum",
    "돋움체", "DotumChe", "새굴림", "New Gulim", "나눔고딕", "NanumGothic",
    "나눔바른고딕", "함초롬돋움", "HCR Dotum", "Apple SD Gothic Neo",
    "Noto Sans KR", "Noto Sans CJK KR", "본고딕",
];
const SERIF_ALIASES: &[&str] = &[
    "나눔명조", "바탕", "Batang", "바탕체", "BatangChe", "명조", "신명조",
    "HY신명조", "휴먼명조", "함초롬바탕", "HCR Batang", "은바탕", "UnBatang",
    "Noto Serif KR", "Noto Serif CJK KR", "본명조", "궁서", "Gungsuh",
    "궁서체", "GungsuhChe",
];

fn main() {
    let want_fonts = std::env::var("RDOC_BENCH3_FONTS").as_deref() != Ok("0");
    let want_aliases = std::env::var("RDOC_BENCH3_ALIASES").as_deref() != Ok("0");
    let paras: usize = std::env::var("RDOC_BENCH3_PARAS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(700);

    // The same open-font set the web app registers, from web/fonts/.
    let sources: &[(&str, &str)] = &[
        // The dev machine's malgun.ttf is registered first by the web app.
        ("Malgun Gothic", "web/malgun.ttf"),
        ("Pretendard", "web/fonts/Pretendard-Regular.otf"),
        ("Pretendard", "web/fonts/Pretendard-Bold.otf"),
        ("NanumMyeongjo", "web/fonts/NanumMyeongjo-Regular.ttf"),
        ("NanumMyeongjo", "web/fonts/NanumMyeongjo-Bold.ttf"),
    ];
    let mut owned: Vec<(String, Vec<u8>)> = Vec::new();
    if want_fonts {
        for (family, path) in sources {
            match std::fs::read(path) {
                Ok(bytes) => owned.push(((*family).to_owned(), bytes)),
                Err(e) => eprintln!("skip {path}: {e}"),
            }
        }
    }
    let fonts: Vec<(&str, &[u8])> = owned
        .iter()
        .map(|(f, b)| (f.as_str(), b.as_slice()))
        .collect();
    let total_font_bytes: usize = owned.iter().map(|(_, b)| b.len()).sum();

    let mut alias_pairs: Vec<(&str, &str)> = Vec::new();
    if want_aliases && want_fonts {
        for name in SANS_ALIASES {
            alias_pairs.push((name, "Pretendard"));
        }
        for name in SERIF_ALIASES {
            alias_pairs.push((name, "NanumMyeongjo"));
        }
    }

    let mut doc = rdocx::Document::new();
    doc.add_paragraph("Relayout benchmark").style("Heading1");
    for i in 0..paras {
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

    let relayout = |doc: &rdocx::Document| {
        doc.layout_with_fonts_aliases_and_bundled_fallback(&fonts, &alias_pairs)
            .expect("layout")
    };

    let t = Instant::now();
    let layout = relayout(&doc);
    let cold = t.elapsed().as_secs_f64() * 1000.0;
    let pages = layout.layout.pages.len();
    drop(layout);

    let mut keystroke = Vec::new();
    for k in 0..10 {
        assert!(insert_at(&mut doc, paras / 2, 10 + k, "x"));
        let t = Instant::now();
        let _ = relayout(&doc);
        keystroke.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    let mean = keystroke.iter().sum::<f64>() / keystroke.len() as f64;
    let min = keystroke.iter().cloned().fold(f64::MAX, f64::min);
    println!(
        "fonts={} ({} KB) aliases={} paragraphs={} pages={}",
        fonts.len(),
        total_font_bytes / 1024,
        alias_pairs.len(),
        paras,
        pages
    );
    println!("cold layout: {cold:.0} ms");
    println!("browser-path relayout per keystroke: mean {mean:.0} ms, min {min:.0} ms (n=10)");
}
