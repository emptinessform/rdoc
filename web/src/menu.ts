// Menubar: dropdown open/close behavior and the command wiring for menu
// items. Items marked data-cmd call existing editor commands; items with
// their own ids (#demo, #save, #thumbtoggle) keep their original handlers
// and the menu only closes around them.

import { report } from "./render.js";
import {
  doUndo, doRedo, selectAll, insertFootnote, insertEndnote, deleteNote,
  toggleFmt,
} from "./edit.js";
import { copySelection, cutSelection, doPaste } from "./clipboard.js";
import { openFind, openReplace } from "./find.js";
import { alignSelection, tableOp, toggleList } from "./format.js";

const COMMANDS: Record<string, () => void> = {
  openFile: () => (document.getElementById("file") as HTMLInputElement).click(),
  insertImage: () => (document.getElementById("imgfile") as HTMLInputElement).click(),
  undo: doUndo,
  redo: doRedo,
  cut: cutSelection,
  copy: () => void copySelection(),
  paste: async () => {
    // Programmatic clipboard reads need a permission real Ctrl+V doesn't.
    try { doPaste(await navigator.clipboard.readText()); }
    catch (e) { report("붙여넣기는 Ctrl+V를 사용하세요 (브라우저 권한)"); }
  },
  selectAll,
  find: openFind,
  replace: openReplace,
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
  rowAdd: () => tableOp("r"),
  rowDel: () => tableOp("R"),
  colAdd: () => tableOp("c"),
  colDel: () => tableOp("C"),
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
