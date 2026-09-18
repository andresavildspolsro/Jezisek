// Tisknutelné seznamy: stejný dokument se dá stáhnout jako soubor, vytisknout
// nebo (po zapnutí odesílání) poslat e-mailem. Držíme se jednoho HTML, aby
// papír, obrazovka i e-mail vypadaly stejně.

import type { ExtraGift, Gift, Purchase } from './api';
import { hostOf, TIERS, tierInfo } from './ui';

export type ExportKind = 'purchases' | 'wishlist' | 'mine';

interface Row {
  title: string;
  tier: 1 | 2 | 3;
  url: string | null;
  note: string | null;
  badge?: string;
  /** Moje soukromá značka „mám koupeno“; v seznamu přání se nepoužívá. */
  done?: boolean;
}

interface Section {
  heading: string;
  subheading?: string;
  rows: Row[];
}

export interface ExportDoc {
  title: string;
  intro: string;
  sections: Section[];
  filename: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'seznam'
  );
}

function today(): string {
  return new Date().toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
}

function giftRow(g: Gift | ExtraGift, badge?: string, withDone = false): Row {
  return { title: g.title, tier: g.tier, url: g.url, note: g.note, badge, done: withDone ? g.bought === true : undefined };
}

/** Moje nákupy: co komu kupuju, včetně dárků mimo seznam a lidí mimo aplikaci. */
export function purchasesDoc(purchases: Purchase[]): ExportDoc {
  const all = purchases.flatMap((p) => [...p.gifts, ...p.extras]);
  const done = all.filter((g) => g.bought === true).length;
  return {
    title: 'Moje nákupy',
    intro: `${all.length} ${all.length === 1 ? 'dárek' : all.length < 5 ? 'dárky' : 'dárků'} pro ${purchases.length} ${
      purchases.length === 1 ? 'člověka' : purchases.length < 5 ? 'lidi' : 'lidí'
    } · koupeno ${done} z ${all.length} · ${today()}`,
    filename: `jezisek-nakupy-${new Date().toISOString().slice(0, 10)}`,
    sections: purchases.map((p) => ({
      heading: p.person_name,
      subheading: p.off_app ? 'není v aplikaci' : undefined,
      rows: [...p.gifts.map((g) => giftRow(g, undefined, true)), ...p.extras.map((e) => giftRow(e, 'mimo seznam', true))],
    })),
  };
}

/**
 * Seznam přání jednoho člověka. Stav koupení se do dokumentu nikdy nedostane,
 * aby se dal bez obav poslat dál.
 */
export function wishlistDoc(personName: string, gifts: Gift[], mine: boolean): ExportDoc {
  return {
    title: mine ? 'Moje přání' : `Přání: ${personName}`,
    intro: `${gifts.length} ${gifts.length === 1 ? 'přání' : 'přání'} · ${today()}`,
    filename: `jezisek-prani-${slug(mine ? 'moje' : personName)}`,
    sections: [{ heading: personName, rows: gifts.map((g) => giftRow(g)) }],
  };
}

/** Jeden dokument pro tisk, stažení i e-mail. */
export function renderDoc(doc: ExportDoc): string {
  const legend = TIERS.map((t) => `<span class="pill t${t.tier}">${esc(t.label)}</span>`).join(' ');
  const sections = doc.sections
    .map((s) => {
      const rows =
        s.rows.length === 0
          ? '<p class="empty">Zatím nic.</p>'
          : s.rows
              .map(
                (r) => `<li class="${r.done ? 'done' : ''}">
        <div class="row"><span class="check">${r.done ? '✓' : ''}</span><span class="title">${esc(r.title)}</span>
          <span class="pill t${r.tier}">${esc(tierInfo(r.tier).label)}</span>
          ${r.badge ? `<span class="pill badge">${esc(r.badge)}</span>` : ''}
        </div>
        ${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}
        ${r.url ? `<div class="url"><a href="${esc(r.url)}">${esc(hostOf(r.url))}</a> <span class="full">${esc(r.url)}</span></div>` : ''}
      </li>`,
              )
              .join('\n');
      return `<section>
      <h2>${esc(s.heading)}${s.subheading ? ` <span class="pill badge">${esc(s.subheading)}</span>` : ''}</h2>
      <ul>${rows}</ul>
    </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)} · Ježíšek</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
         color: #1f2a24; background: #f6efe3; line-height: 1.45; }
  .sheet { max-width: 720px; margin: 0 auto; background: #fffcf6; border: 1px solid #e3d9c8;
           border-radius: 14px; padding: 28px; }
  h1 { margin: 0; font-size: 1.7rem; color: #0f3d2e; }
  .intro { color: #6b7a72; margin: 6px 0 4px; font-size: .95rem; }
  .legend { margin: 12px 0 20px; font-size: .8rem; }
  section { margin-top: 22px; page-break-inside: avoid; }
  h2 { margin: 0 0 8px; font-size: 1.15rem; color: #0f3d2e; border-bottom: 1px solid #e3d9c8; padding-bottom: 6px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { padding: 10px 0; border-bottom: 1px dashed #e3d9c8; page-break-inside: avoid; }
  li:last-child { border-bottom: 0; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .check { width: 15px; height: 15px; border: 1.5px solid #6b7a72; border-radius: 3px; flex: none;
           display: grid; place-items: center; font-size: 11px; line-height: 1; color: #fff; }
  li.done .check { background: #2e7d4f; border-color: #2e7d4f; }
  li.done .title { color: #6b7a72; }
  .title { font-weight: 600; }
  .pill { font-size: .72rem; font-weight: 700; padding: 2px 8px; border-radius: 999px;
          background: #e2f2e7; color: #2e7d4f; white-space: nowrap; }
  .pill.t2 { background: #fbf1dc; color: #8a6416; }
  .pill.t3 { background: #fbe4e1; color: #b3261e; }
  .pill.badge { background: #ece6da; color: #6b7a72; }
  .note { color: #6b7a72; font-size: .9rem; margin-left: 22px; }
  .url { font-size: .85rem; margin-left: 22px; }
  .url a { color: #1b5e46; }
  .url .full { display: none; color: #6b7a72; }
  .empty { color: #6b7a72; font-size: .9rem; margin: 0; }
  footer { margin-top: 24px; color: #6b7a72; font-size: .8rem; text-align: center; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border: 0; border-radius: 0; padding: 0; max-width: none; }
    .url a { display: none; }
    .url .full { display: inline; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <h1>${esc(doc.title)}</h1>
    <p class="intro">${esc(doc.intro)}</p>
    <div class="legend">${legend}</div>
    ${sections}
    <footer>Ježíšek · vytištěno ${esc(today())}</footer>
  </div>
</body>
</html>`;
}

/** Stáhne dokument jako soubor .html, který jde otevřít i vytisknout. */
export function downloadDoc(doc: ExportDoc): void {
  const blob = new Blob([renderDoc(doc)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.filename}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Otevře tiskový dialog nad dokumentem, aniž by opustil aplikaci. */
export function printDoc(doc: ExportDoc): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    return;
  }
  win.document.open();
  win.document.write(renderDoc(doc));
  win.document.close();
  const go = () => {
    win.focus();
    win.print();
    setTimeout(() => frame.remove(), 1000);
  };
  if (win.document.readyState === 'complete') setTimeout(go, 50);
  else frame.addEventListener('load', () => setTimeout(go, 50));
}
