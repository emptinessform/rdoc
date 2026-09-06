// Paints the UI in the resolved locale before the (much slower) wasm
// bootstrap in main.ts runs, and wires the language picker.

import { applyI18n, getLocale, setLocale, type Locale } from "./index.js";

applyI18n();

const pick = document.getElementById("lang") as HTMLSelectElement | null;
if (pick) {
  pick.value = getLocale();
  pick.addEventListener("change", () => setLocale(pick.value as Locale));
}
