import { useSyncExternalStore } from 'react';
import type { PostProcessorModule } from 'i18next';

/**
 * The site's editable text (Admin > Site content > Site pages), Oct 2026.
 *
 * The database table public.site_content holds the blocks M3 published
 * (supabase/migrations/20261021162000_site_content.sql). Nothing here is
 * required: with no row, no table or no network, every page shows the text
 * written in its code, exactly as before.
 *
 *   key 'text:<i18n key>'   replaces one sentence of the site. It is applied by
 *                           the i18next post-processor below, so the page's own
 *                           t('<i18n key>', 'English default') call returns the
 *                           published text. The string files are never changed:
 *                           t(key, { postProcess: [] }) still gives the code's text.
 *   'legal.<doc>' (rich)    a legal page's body (LegalLayout), sanitized on display.
 *   'home.hero', 'help.custom' (json)  read by HomePage and buildHelpSections.
 *
 * Preview: the admin writes its unpublished changes to localStorage
 * (SITE_PREVIEW_STORAGE) and opens the page with ?site-preview=1. That tab, and
 * only that tab (sessionStorage), lays the draft over the published blocks and
 * shows a bar saying so. Other visitors never see a draft: it lives in the
 * editor's own browser.
 *
 * This module has no Supabase import (src/i18n/index.ts registers the
 * post-processor); load.ts fetches the rows.
 */

export type SiteContentKind = 'text' | 'rich' | 'json';
export type SiteContentBody = Record<string, unknown>;

export interface SiteContentRow {
  key: string;
  kind: SiteContentKind;
  /** null in a preview draft: back to the code's text. */
  body: SiteContentBody | null;
}

export const SITE_PREVIEW_PARAM = 'site-preview';
export const SITE_PREVIEW_STORAGE = 'smc-site-preview';
const PREVIEW_TAB_FLAG = 'smc-site-preview-on';
export const SITE_CONTENT_EVENT = 'siteContentUpdated';

let published = new Map<string, SiteContentRow>();
let previewDraft: Map<string, SiteContentRow> | null = null;
let texts = new Map<string, string>();
let blocks = new Map<string, SiteContentBody>();
const listeners = new Set<() => void>();
let notifyI18n: (() => void) | null = null;

let lastSignature = '[]';

function rebuild() {
  const merged = new Map(published);
  if (previewDraft) {
    for (const [key, row] of previewDraft) {
      if (row.body) merged.set(key, row);
      else merged.delete(key);
    }
  }
  // The network usually hands back what the cache had: no re-render of the whole site then.
  const signature = JSON.stringify([...merged.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  if (signature === lastSignature) return;
  lastSignature = signature;
  const nextTexts = new Map<string, string>();
  const nextBlocks = new Map<string, SiteContentBody>();
  for (const [key, row] of merged) {
    if (!row.body || typeof row.body !== 'object') continue;
    if (row.kind === 'text') {
      const text = row.body.text;
      if (key.startsWith('text:') && typeof text === 'string' && text.trim()) nextTexts.set(key.slice(5), text);
    } else {
      nextBlocks.set(key, row.body);
    }
  }
  texts = nextTexts;
  blocks = nextBlocks;
  listeners.forEach((l) => l());
  notifyI18n?.();
}

/** The published rows (from load.ts: the cache first, then the network). */
export function setPublishedSiteContent(rows: SiteContentRow[]) {
  published = new Map(rows.filter(isRow).map((r) => [r.key, r]));
  rebuild();
}

function isRow(r: unknown): r is SiteContentRow {
  const row = r as SiteContentRow | null;
  return !!row && typeof row.key === 'string' && (row.kind === 'text' || row.kind === 'rich' || row.kind === 'json');
}

/** src/i18n/index.ts: how to tell react-i18next that the texts changed (it re-renders on this event). */
export function bindSiteContentToI18n(notify: () => void) {
  notifyI18n = notify;
}

/**
 * Replaces the result of t(key) with the published text for that key.
 * Text with {{placeholders}} is interpolated with the call's own values.
 */
export const siteContentPostProcessor: PostProcessorModule = {
  type: 'postProcessor',
  name: 'siteContent',
  process(value, key, options, translator) {
    if (texts.size === 0 || typeof value !== 'string') return value;
    const k = Array.isArray(key) ? key[0] : key;
    const text = typeof k === 'string' ? texts.get(k) : undefined;
    if (text === undefined) return value;
    if (text.includes('{{') && translator?.interpolator) {
      try {
        return translator.interpolator.interpolate(text, options, translator.language, options);
      } catch {
        return text;
      }
    }
    return text;
  },
};

/* ─── Reading blocks ─────────────────────────────────────────────── */

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** A published (or previewed) block, or null: the page then uses its code. */
export function siteBlock<T = SiteContentBody>(key: string): T | null {
  return (blocks.get(key) as T | undefined) ?? null;
}

/** The same, re-rendering when it changes. */
export function useSiteBlock<T = SiteContentBody>(key: string): T | null {
  return useSyncExternalStore(
    subscribe,
    () => (blocks.get(key) as T | undefined) ?? null,
    () => null,
  );
}

/** M3 published its own text for this i18n key. */
export function hasSiteText(i18nKey: string): boolean {
  return texts.has(i18nKey);
}

/* ─── Preview ────────────────────────────────────────────────────── */

let previewOn = false;

/** This tab shows the editor's unpublished changes (?site-preview=1). */
export function isSitePreview(): boolean {
  return previewOn;
}

function readPreviewDraft(): Map<string, SiteContentRow> | null {
  try {
    const raw = window.localStorage.getItem(SITE_PREVIEW_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return null;
    return new Map(parsed.items.filter(isRow).map((r) => [r.key, r]));
  } catch {
    return null;
  }
}

function showPreviewBar() {
  if (typeof document === 'undefined' || document.getElementById('site-preview-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'site-preview-bar';
  bar.setAttribute('role', 'status');
  bar.className = 'fixed inset-x-0 bottom-0 z-[200] flex flex-wrap items-center justify-center gap-3 bg-navy px-4 py-3 text-center text-[15px] leading-5 text-white shadow-drawer';
  const text = document.createElement('span');
  text.textContent = 'Preview of your changes. They are not published: visitors still see the current version.';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'min-h-10 rounded-pill bg-gold px-4 font-semibold text-navy';
  close.textContent = 'Close the preview';
  close.addEventListener('click', () => {
    try { window.sessionStorage.removeItem(PREVIEW_TAB_FLAG); } catch { /* storage blocked */ }
    const url = new URL(window.location.href);
    url.searchParams.delete(SITE_PREVIEW_PARAM);
    window.location.replace(url.toString());
  });
  bar.append(text, close);
  const mount = () => document.body.appendChild(bar);
  if (document.body) mount();
  else window.addEventListener('DOMContentLoaded', mount, { once: true });
}

/** Called once at start (load.ts). */
export function initSitePreview() {
  if (typeof window === 'undefined') return;
  let on = false;
  try {
    on = new URLSearchParams(window.location.search).get(SITE_PREVIEW_PARAM) === '1'
      || window.sessionStorage.getItem(PREVIEW_TAB_FLAG) === '1';
    if (on) window.sessionStorage.setItem(PREVIEW_TAB_FLAG, '1');
  } catch {
    on = new URLSearchParams(window.location.search).get(SITE_PREVIEW_PARAM) === '1';
  }
  if (!on) return;
  previewDraft = readPreviewDraft();
  if (!previewDraft) return;
  previewOn = true;
  showPreviewBar();
  rebuild();
  // The editor's tab writes the draft again on every change: follow it live.
  window.addEventListener('storage', (e) => {
    if (e.key !== SITE_PREVIEW_STORAGE) return;
    previewDraft = readPreviewDraft() ?? new Map();
    rebuild();
  });
}
