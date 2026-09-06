// UI localization. Every user-facing string in the editor comes from here —
// source files hold keys, not literals (CLAUDE.md, "다국어 규칙").
//
// Locale is resolved once, in this order: ?lang= → localStorage → the
// browser's language. Korean is the fallback table, so a key missing from
// another locale degrades to Korean rather than to a raw key.

import { ko } from "./ko.js";
import { en } from "./en.js";

export type Locale = "ko" | "en";

const TABLES: Record<Locale, Record<string, string>> = { ko, en };
export const LOCALES: Locale[] = ["ko", "en"];
const STORAGE_KEY = "rdoc.lang";

function isLocale(v: string | null): v is Locale {
  return v === "ko" || v === "en";
}

function stored(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch { return null; }          // private mode / blocked storage
}

function resolve(): Locale {
  const q = new URLSearchParams(location.search).get("lang");
  if (isLocale(q)) return q;
  const s = stored();
  if (s) return s;
  return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

let locale: Locale = resolve();

export function getLocale(): Locale { return locale; }

/** Switch locale, remember it, and re-render every translated node. */
export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  applyI18n();
}

/** Look up `key`, substituting {name} placeholders from `vars`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const s = TABLES[locale][key] ?? ko[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m);
}

/**
 * Fill in every translated node under `root`:
 *   data-i18n        → the element's leading text node
 *   data-i18n-title  → the title attribute
 *   data-i18n-ph     → the placeholder attribute
 * Only the leading text node is touched, so trailing children (the <kbd>
 * shortcut hints in the menus) survive a locale switch.
 */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const s = t(el.dataset.i18n!);
    const first = el.firstChild;
    if (first && first.nodeType === Node.TEXT_NODE) first.nodeValue = s;
    else el.insertBefore(document.createTextNode(s), el.firstChild);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle!);
  });
  root.querySelectorAll<HTMLInputElement>("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh!);
  });
  document.documentElement.lang = locale;
}
