// Menubar: dropdown open/close behavior and the command wiring for menu
// items. Items marked data-cmd call existing editor commands; items with
// their own ids (#demo, #save, #thumbtoggle) keep their original handlers
// and the menu only closes around them.

import { apply, report } from "./render.js";
import { S } from "./state.js";
import { edit } from "./edit.js";
import { finalizeComposition } from "./ime.js";
import {
  toggleComments, openCommentBar, removeCommentAtCaret, resolveCommentAtCaret,
} from "./comments.js";

// View switch, not an edit: no history entry; the wasm side re-renders
// the newly selected projection.
export function toggleTrackedView(on?: boolean) {
  finalizeComposition();
  S.trackedView = on ?? !S.trackedView;
  S.caret = null;
  S.sel = null;
  const json = S.conv.set_revision_view(S.trackedView);
  apply(json, 0);
  report(t(S.trackedView ? "msg.trackOn" : "msg.trackOff"));
}
import {
  doUndo, doRedo, selectAll, insertFootnote, insertEndnote, deleteNote,
  toggleFmt,
} from "./edit.js";
import { copySelection, cutSelection, doPaste } from "./clipboard.js";
import { openFind, openReplace } from "./find.js";
import {
  alignSelection, tableOp, toggleList, applyLineSpacing, mergeCells, splitCell,
  openTableBar, openBorderBar,
} from "./format.js";
import { openLinkBar, removeLink } from "./link.js";
import { t } from "./i18n/index.js";

// Page-setup presets (pt): paper sizes are portrait dimensions — the
// wasm op preserves the current orientation.
function pageOp(fn: () => string) {
  edit(() => {
    const json = fn();
    S.caret = null;
    S.sel = null;
    return json;
  });
}

// Sample gallery: the deployed test fixtures double as feature demos.
async function loadSample(url: string, after?: () => void) {
  try {
    // Opening another document must not inherit the read-only Tracked
    // view from the previous one.
    if (S.trackedView) toggleTrackedView(false);
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    S.conv.load_docx(bytes);
    const t0 = performance.now();
    S.caret = null;
    S.sel = null;
    apply(S.conv.render(), performance.now() - t0);
    after?.();
  } catch (e) {
    report(t("msg.sampleFailed", { err: String(e) }));
  }
}

const COMMANDS: Record<string, () => void> = {
  openFile: () => (document.getElementById("file") as HTMLInputElement).click(),
  sampleReport: () => void loadSample("./report-sample.docx", () => {
    report(t("msg.sampleReport"));
  }),
  sampleTrack: () => void loadSample("./trackview-test.docx", () => {
    if (!S.trackedView) toggleTrackedView(true);
    report(t("msg.sampleTrack"));
  }),
  sampleComment: () => void loadSample("./comment-test.docx", () => {
    toggleComments(true);
  }),
  sampleFonts: () => void loadSample("./fontmap-test.docx", () => {
    report(t("msg.sampleFonts"));
  }),
  savePdf: () => {
    try {
      const bytes = S.conv.save_pdf();
      const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "rdoc.pdf";
      a.click();
      URL.revokeObjectURL(a.href);
      report(t("msg.pdfSaved", { bytes: bytes.length.toLocaleString() }));
    } catch (err) {
      report(t("msg.pdfFailed", { err: String(err) }));
    }
  },
  docStats: () => {
    try {
      const st = JSON.parse(S.conv.doc_stats());
      report(t("msg.stats", { pages: st.pages, paragraphs: st.paragraphs, words: st.words, chars: st.chars, noSpace: st.chars_no_space }));
    } catch (e) { report(t("msg.openFirst")); }
  },
  paperA4: () => pageOp(() => S.conv.set_paper(595.3, 841.9)),
  paperLetter: () => pageOp(() => S.conv.set_paper(612, 792)),
  paperLegal: () => pageOp(() => S.conv.set_paper(612, 1008)),
  orientPortrait: () => pageOp(() => S.conv.set_orientation(false)),
  orientLandscape: () => pageOp(() => S.conv.set_orientation(true)),
  marginsNormal: () => pageOp(() => S.conv.set_margins_pt(72, 72, 72, 72)),
  marginsNarrow: () => pageOp(() => S.conv.set_margins_pt(36, 36, 36, 36)),
  marginsWide: () => pageOp(() => S.conv.set_margins_pt(72, 144, 72, 144)),
  trackChanges: () => toggleTrackedView(),
  // Accept/reject work on the final view: leave the read-only Tracked
  // projection first, then run as a normal one-undo edit.
  acceptAll: () => {
    if (S.trackedView) toggleTrackedView(false);
    edit(() => S.conv.accept_all_revisions());
  },
  rejectAll: () => {
    if (S.trackedView) toggleTrackedView(false);
    edit(() => S.conv.reject_all_revisions());
  },
  comments: () => toggleComments(),
  commentAdd: openCommentBar,
  commentRemove: removeCommentAtCaret,
  commentResolve: resolveCommentAtCaret,
  insertImage: () => (document.getElementById("imgfile") as HTMLInputElement).click(),
  undo: doUndo,
  redo: doRedo,
  cut: cutSelection,
  copy: () => void copySelection(),
  paste: async () => {
    // Programmatic clipboard reads need a permission real Ctrl+V doesn't.
    try { doPaste(await navigator.clipboard.readText()); }
    catch (e) { report(t("msg.pasteShortcut")); }
  },
  selectAll,
  find: openFind,
  replace: openReplace,
  link: openLinkBar,
  unlink: removeLink,
  footnote: insertFootnote,
  endnote: insertEndnote,
  deleteNote,
  bold: () => toggleFmt("b"),
  italic: () => toggleFmt("i"),
  underline: () => toggleFmt("u"),
  alignL: () => alignSelection("l"),
  alignC: () => alignSelection("c"),
  alignR: () => alignSelection("r"),
  listBullet: () => toggleList("bullet"),
  listNumber: () => toggleList("number"),
  spacing1: () => applyLineSpacing(1),
  spacing15: () => applyLineSpacing(1.5),
  spacing2: () => applyLineSpacing(2),
  tableBorders: openBorderBar,
  insertTable: openTableBar,
  rowAdd: () => tableOp("r"),
  rowDel: () => tableOp("R"),
  colAdd: () => tableOp("c"),
  colDel: () => tableOp("C"),
  mergeCells,
  splitCell,
};

export function wireMenu() {
  const menus = [...document.querySelectorAll<HTMLElement>("#menubar .menu")];
  const closeAll = () => menus.forEach((m) => m.classList.remove("open"));
  const anyOpen = () => menus.some((m) => m.classList.contains("open"));

  for (const menu of menus) {
    const title = menu.querySelector<HTMLButtonElement>(".mtitle")!;
    title.addEventListener("mousedown", (e) => {
      e.preventDefault(); // keep the editor caret/focus untouched
      const wasOpen = menu.classList.contains("open");
      closeAll();
      if (!wasOpen) menu.classList.add("open");
    });
    // Sliding between titles while one menu is open switches menus.
    title.addEventListener("mouseenter", () => {
      if (anyOpen() && !menu.classList.contains("open")) {
        closeAll();
        menu.classList.add("open");
      }
    });
  }

  // Any menu item click runs, then the menu closes (including #demo/#save/
  // #thumbtoggle, whose own handlers stay wired elsewhere).
  document.querySelectorAll<HTMLButtonElement>("#menubar .mlist button").forEach((b) => {
    b.addEventListener("click", () => {
      const cmd = b.dataset.cmd;
      closeAll();
      if (cmd) void COMMANDS[cmd]?.();
    });
  });

  document.addEventListener("mousedown", (e) => {
    if (!(e.target as Element).closest?.(".menu")) closeAll();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && anyOpen()) closeAll();
  }, { capture: true });
}
