// Drobné pomůcky pro stavbu rozhraní bez knihovny: tvorba prvků, cenové
// hladiny, toast, potvrzovací dialog a editor seznamu dárků.

import type { Gift, GiftInput, Tier } from './api';

export type Child = Node | string | number | null | undefined | false | Child[];

type Props = Record<string, unknown>;

function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(parent, c);
    else if (c instanceof Node) parent.appendChild(c);
    else parent.appendChild(document.createTextNode(String(c)));
  }
}

export function mount(parent: Node, ...children: Child[]): void {
  append(parent, children);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'style') node.setAttribute('style', String(v));
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'dataset') Object.assign(node.dataset, v as Record<string, string>);
    else if (k in node) (node as unknown as Record<string, unknown>)[k] = v;
    else node.setAttribute(k, String(v));
  }
  append(node, children);
  return node;
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '?';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

// Cenové hladiny --------------------------------------------------------

export const TIERS: { tier: Tier; label: string; short: string; pill: string }[] = [
  { tier: 1, label: 'do 1 000 Kč', short: 'do 1 000', pill: '' },
  { tier: 2, label: '1 000 až 3 000 Kč', short: 'do 3 000', pill: 'gold' },
  { tier: 3, label: 'nad 3 000 Kč', short: 'nad 3 000', pill: 'red' },
];

export function tierInfo(tier: Tier) {
  return TIERS[tier - 1] ?? TIERS[0];
}

export function tierPill(tier: Tier): HTMLElement {
  const t = tierInfo(tier);
  return el('span', { class: `pill ${t.pill}`.trim() }, t.label);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'odkaz';
  }
}

// Toast a dialogy ---------------------------------------------------------

let toastTimer: number | undefined;

export function toast(message: string, isError = false): void {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el('div', { class: `toast ${isError ? 'err' : ''}`.trim(), role: 'status' }, message);
  document.body.appendChild(t);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), isError ? 4200 : 2600);
}

/** Otevře dialog s obsahem. Vrací funkci pro zavření. */
export function openSheet(content: Child[]): () => void {
  const dlg = el('dialog', { class: 'sheet' }, el('div', { class: 'inner' }, ...content));
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.showModal();
  return () => dlg.close();
}

export function confirmSheet(
  title: string,
  text: string,
  okLabel = 'Ano',
  danger = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      close();
      resolve(v);
    };
    const close = openSheet([
      el('h2', {}, title),
      el('p', { class: 'muted' }, text),
      el(
        'div',
        { class: 'row', style: 'justify-content:flex-end' },
        el('button', { class: 'btn secondary', onClick: () => finish(false) }, 'Zpět'),
        el('button', { class: `btn ${danger ? 'danger' : ''}`.trim(), onClick: () => finish(true) }, okLabel),
      ),
    ]);
  });
}

// Formulářové prvky -------------------------------------------------------

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return el(
    'div',
    { class: 'field' },
    el('label', { htmlFor: id }, label),
    input,
    hint ? el('span', { class: 'hint' }, hint) : null,
  );
}

export function textInput(props: Props = {}): HTMLInputElement {
  return el('input', { class: 'input', type: 'text', ...props });
}

export function pinInput(props: Props = {}): HTMLInputElement {
  return el('input', {
    class: 'input pin',
    type: 'password',
    inputMode: 'numeric',
    pattern: '[0-9]*',
    autocomplete: 'off',
    maxLength: 6,
    placeholder: '••••',
    ...props,
  });
}

export function errorBox(text: string): HTMLElement {
  return el('div', { class: 'error', role: 'alert' }, text);
}

/** Tři přepínací tlačítka cenové hladiny. */
export function tierPicker(initial: Tier | null = null): { root: HTMLElement; get: () => Tier | null } {
  let value: Tier | null = initial;
  const buttons = TIERS.map((t) =>
    el(
      'button',
      {
        type: 'button',
        class: 'tier-btn',
        dataset: { tier: String(t.tier) },
        'aria-pressed': String(value === t.tier),
        onClick: () => {
          value = t.tier;
          buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tier === String(t.tier))));
        },
      },
      t.label,
    ),
  );
  return { root: el('div', { class: 'tiers', role: 'group', 'aria-label': 'Cenová hladina' }, ...buttons), get: () => value };
}

export interface GiftFormValues {
  ok: boolean;
  value: GiftInput | null;
  problem?: string;
}

/** Pole jednoho dárku (název, hladina, odkaz, poznámka). */
export function giftFields(initial?: Partial<Gift>): { root: HTMLElement; read: () => GiftFormValues; focus: () => void } {
  const title = textInput({ placeholder: 'Např. kniha, sluchátka, poukaz…', value: initial?.title ?? '', maxLength: 120 });
  const tiers = tierPicker(initial?.tier ?? null);
  const url = textInput({ placeholder: 'www.obchod.cz/…', value: initial?.url ?? '', inputMode: 'url', maxLength: 2000 });
  const note = textInput({ placeholder: 'Velikost, barva, varianta…', value: initial?.note ?? '', maxLength: 500 });
  const root = el(
    'div',
    { class: 'stack' },
    field('Co si přeješ', title),
    field('Cenová hladina', tiers.root),
    field('Kde to sehnat (odkaz)', url, 'Nepovinné, ale ostatním hodně pomůže.'),
    field('Poznámka', note, 'Nepovinné.'),
  );
  return {
    root,
    focus: () => title.focus(),
    read: () => {
      const t = title.value.trim();
      const tier = tiers.get();
      if (!t) return { ok: false, value: null, problem: 'Napiš, co si přeješ.' };
      if (!tier) return { ok: false, value: null, problem: 'Vyber cenovou hladinu.' };
      return { ok: true, value: { title: t, tier, url: url.value.trim() || null, note: note.value.trim() || null } };
    },
  };
}

/** Editor více dárků najednou (registrace, nová skupina, nové dítě). */
export function giftListEditor(min = 3): { root: HTMLElement; read: () => { ok: boolean; gifts: GiftInput[]; problem?: string } } {
  const rows: { wrap: HTMLElement; fields: ReturnType<typeof giftFields> }[] = [];
  const list = el('div', { class: 'stack' });

  const renumber = () => {
    rows.forEach((r, i) => {
      const head = r.wrap.querySelector('.head .n');
      if (head) head.textContent = `Dárek ${i + 1}`;
      const rm = r.wrap.querySelector<HTMLButtonElement>('.head button');
      if (rm) rm.hidden = rows.length <= min;
    });
  };

  const addRow = (focus = false) => {
    const fields = giftFields();
    const wrap = el(
      'div',
      { class: 'gift-row' },
      el(
        'div',
        { class: 'head' },
        el('span', { class: 'n' }),
        el(
          'button',
          {
            type: 'button',
            class: 'btn ghost small',
            onClick: () => {
              const i = rows.findIndex((r) => r.wrap === wrap);
              if (i >= 0) rows.splice(i, 1);
              wrap.remove();
              renumber();
            },
          },
          'Odebrat',
        ),
      ),
      fields.root,
    );
    rows.push({ wrap, fields });
    list.appendChild(wrap);
    renumber();
    if (focus) {
      fields.focus();
      wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  for (let i = 0; i < min; i++) addRow();

  const root = el(
    'div',
    { class: 'stack' },
    list,
    el('button', { type: 'button', class: 'btn secondary', onClick: () => addRow(true) }, '+ Přidat další dárek'),
  );

  return {
    root,
    read: () => {
      const gifts: GiftInput[] = [];
      for (const r of rows) {
        const v = r.fields.read();
        if (!v.ok || !v.value) {
          r.wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
          r.fields.focus();
          return { ok: false, gifts: [], problem: v.problem };
        }
        gifts.push(v.value);
      }
      if (gifts.length < min) return { ok: false, gifts: [], problem: `Zadej prosím alespoň ${min} dárky.` };
      return { ok: true, gifts };
    },
  };
}

// Sdílení pozvánky ---------------------------------------------------------

export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}#/s/${code}`;
}

export async function shareInvite(groupName: string, code: string): Promise<void> {
  const url = inviteLink(code);
  const text = `Ahoj! Přidej se k nám v Ježíškovi do skupiny „${groupName}“. Napiš, co si přeješ, a uvidíš přání ostatních: ${url}`;
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title: 'Ježíšek', text, url });
      return;
    } catch {
      /* zrušeno uživatelem, zkusíme kopírovat */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Pozvánka zkopírována, pošli ji rodině.');
  } catch {
    window.prompt('Zkopíruj odkaz na pozvánku:', url);
  }
}

export function daysToChristmas(): number {
  const now = new Date();
  let eve = new Date(now.getFullYear(), 11, 24);
  if (now > new Date(now.getFullYear(), 11, 24, 23, 59, 59)) eve = new Date(now.getFullYear() + 1, 11, 24);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((eve.getTime() - start.getTime()) / 86400000);
}

export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}
