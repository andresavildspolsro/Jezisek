// Obrazovky před přihlášením: úvod, vstup do skupiny (přihlášení / registrace)
// a založení nové skupiny.

import { api, ApiError, errorText, type GroupPreview } from './api';
import { session } from './state';
import {
  clear,
  el,
  errorBox,
  field,
  giftListEditor,
  inviteLink,
  pinInput,
  shareInvite,
  textInput,
  toast,
} from './ui';
import { navigate } from './main';

function hero(title: string, subtitle?: string): HTMLElement {
  return el(
    'header',
    { class: 'hero' },
    el(
      'div',
      { class: 'wrap' },
      el('span', { class: 'emoji', 'aria-hidden': 'true' }, '🎁'),
      el('h1', {}, title),
      subtitle ? el('p', {}, subtitle) : null,
    ),
  );
}

function codeFromInput(v: string): string {
  return v.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ---------------------------------------------------------------------------
// Úvodní stránka
// ---------------------------------------------------------------------------

export async function renderLanding(root: HTMLElement): Promise<void> {
  const code = textInput({ placeholder: 'Kód z pozvánky', autocapitalize: 'characters', autocomplete: 'off', maxLength: 8 });
  const go = () => {
    const c = codeFromInput(code.value);
    if (c.length < 4) {
      toast('Zadej kód z pozvánky.', true);
      code.focus();
      return;
    }
    navigate(`#/s/${c}`);
  };
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });

  const last = session.lastCode;

  root.append(
    hero('Ježíšek', 'Napiš, co si přeješ. Tajně zaškrtni, co koupíš ostatním.'),
    el(
      'main',
      { class: 'wrap plain stack' },
      el(
        'div',
        { class: 'steps' },
        el('div', { class: 'step' }, el('span', { class: 'n' }, '1'), el('div', {}, 'Napiš aspoň tři přání')),
        el('div', { class: 'step' }, el('span', { class: 'n' }, '2'), el('div', {}, 'Pozvi rodinu odkazem')),
        el('div', { class: 'step' }, el('span', { class: 'n' }, '3'), el('div', {}, 'Zaškrtni, co komu koupíš')),
      ),
      last
        ? el(
            'div',
            { class: 'card stack' },
            el('h2', {}, 'Vítej zpátky'),
            el('a', { class: 'btn block', href: `#/s/${last}` }, 'Přihlásit se'),
          )
        : null,
      el(
        'div',
        { class: 'card stack' },
        el('h2', {}, 'Mám pozvánku od rodiny'),
        el('p', { class: 'muted small' }, 'Nejjednodušší je otevřít přímo odkaz, který ti přišel. Nebo opiš kód:'),
        el('div', { class: 'row' }, el('div', { class: 'grow' }, code), el('button', { class: 'btn', onClick: go }, 'Pokračovat')),
      ),
      el(
        'div',
        { class: 'card stack' },
        el('h2', {}, 'Zakládám novou skupinu'),
        el('p', { class: 'muted small' }, 'Pro rodinu, kamarády nebo partu z práce. Dostaneš odkaz, který pošleš ostatním.'),
        el('a', { class: 'btn secondary block', href: '#/novy' }, 'Založit skupinu'),
      ),
      el('p', { class: 'muted small center' }, 'Kdo ti co koupí, se z aplikace nikdy nedozvíš. Překvapení zůstává překvapením.'),
    ),
  );
}

// ---------------------------------------------------------------------------
// Vstup do skupiny podle kódu
// ---------------------------------------------------------------------------

export async function renderGroupEntry(root: HTMLElement, rawCode: string): Promise<void> {
  const code = codeFromInput(rawCode);
  const main = el('main', { class: 'wrap plain stack' }, el('div', { class: 'spinner' }, 'Načítám skupinu…'));
  const head = hero('Ježíšek');
  root.append(head, main);

  const preview = await api.groupPreview(code);
  clear(main);
  if (!preview) {
    main.append(
      el(
        'div',
        { class: 'card stack' },
        el('h2', {}, 'Skupina nenalezena'),
        el('p', { class: 'muted' }, 'Kód z pozvánky nesedí. Zkontroluj odkaz, který ti přišel, nebo si nech poslat nový.'),
        el('a', { class: 'btn secondary', href: '#/' }, 'Na úvod'),
      ),
    );
    return;
  }

  const sub = head.querySelector('h1');
  if (sub) sub.textContent = preview.name;
  head.querySelector('.wrap')?.appendChild(el('p', {}, 'Skupina v Ježíškovi'));

  // Už přihlášený člověk: buď je členem (jdeme dál), nebo se může přidat.
  if (session.token) {
    try {
      const me = await api.me(session.token);
      if (me.groups.some((g) => g.id === preview.id)) {
        session.selectGroup(preview.id, code);
        navigate('#/lide');
        return;
      }
      main.append(joinCard(me.name, preview, code, main));
      return;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'unauthorized') session.end();
      else throw e;
    }
  }

  main.append(entryTabs(preview, code));
}

function joinCard(myName: string, preview: GroupPreview, code: string, main: HTMLElement): HTMLElement {
  const err = el('div');
  return el(
    'div',
    { class: 'card stack' },
    el('h2', {}, `Přidat se do skupiny „${preview.name}“?`),
    el('p', { class: 'muted' }, `Jsi přihlášený jako ${myName}. Ostatní ve skupině uvidí tvoje přání a ty jejich.`),
    err,
    el(
      'button',
      {
        class: 'btn block',
        onClick: async (e: Event) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.disabled = true;
          clear(err);
          try {
            const r = await api.joinGroup(session.token as string, code);
            session.selectGroup(r.group_id, code);
            toast(r.already ? 'V této skupině už jsi.' : `Vítej ve skupině ${r.name}!`);
            navigate('#/lide');
          } catch (ex) {
            err.appendChild(errorBox(errorText(ex)));
            btn.disabled = false;
          }
        },
      },
      'Přidat se',
    ),
    el(
      'button',
      {
        class: 'btn ghost block',
        onClick: () => {
          session.end();
          clear(main);
          main.append(entryTabs(preview, code));
        },
      },
      'Přihlásit se jako někdo jiný',
    ),
  );
}

function entryTabs(preview: GroupPreview, code: string): HTMLElement {
  const hasMembers = preview.members.length > 0;
  let tab: 'login' | 'register' = hasMembers ? 'login' : 'register';
  const body = el('div');
  const tabs = el(
    'div',
    { class: 'tabs', role: 'tablist' },
    el('button', { role: 'tab', onClick: () => show('login') }, 'Už tu jsem'),
    el('button', { role: 'tab', onClick: () => show('register') }, 'Jsem tu poprvé'),
  );
  const show = (t: typeof tab) => {
    tab = t;
    tabs.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String((i === 0) === (t === 'login'))));
    clear(body);
    body.appendChild(t === 'login' ? loginForm(preview, code) : registerForm(preview, code));
  };
  show(tab);
  return el('div', { class: 'stack' }, tabs, body);
}

function loginForm(preview: GroupPreview, code: string): HTMLElement {
  const err = el('div');
  if (preview.members.length === 0) {
    return el(
      'div',
      { class: 'card stack' },
      el('p', { class: 'muted' }, 'Zatím se sem nikdo nezaregistroval. Buď první, klepni na „Jsem tu poprvé“.'),
    );
  }
  const select = el('select', { class: 'input' }, el('option', { value: '' }, 'Vyber svoje jméno…'));
  for (const m of preview.members) select.appendChild(el('option', { value: m.name }, m.name));
  const pin = pinInput({ autocomplete: 'current-password' });
  const submit = async (e: Event) => {
    e.preventDefault();
    clear(err);
    if (!select.value) {
      err.appendChild(errorBox('Vyber svoje jméno.'));
      return;
    }
    btn.disabled = true;
    try {
      const r = await api.login(code, select.value, pin.value);
      session.start(r.token, r.group_id, code);
      toast(`Ahoj, ${select.value}!`);
      navigate('#/lide');
    } catch (ex) {
      err.appendChild(errorBox(errorText(ex)));
      btn.disabled = false;
      pin.value = '';
      pin.focus();
    }
  };
  const btn = el('button', { class: 'btn block', type: 'submit' }, 'Přihlásit se');
  return el(
    'form',
    { class: 'card stack', onSubmit: submit },
    field('Kdo jsi', select),
    field('PIN', pin),
    err,
    btn,
    el('p', { class: 'muted small center' }, 'Zapomenutý PIN ti může nastavit správce aplikace.'),
  );
}

function registerForm(preview: GroupPreview, code: string): HTMLElement {
  const err = el('div');
  const name = textInput({ placeholder: 'Jak ti ostatní říkají', autocomplete: 'name', maxLength: 40 });
  const pin = pinInput({ autocomplete: 'new-password' });
  const pin2 = pinInput({ autocomplete: 'new-password' });
  const gifts = giftListEditor(3);
  const btn = el('button', { class: 'btn block', type: 'submit' }, 'Vytvořit můj seznam');

  const submit = async (e: Event) => {
    e.preventDefault();
    clear(err);
    const fail = (msg: string, focus?: HTMLElement) => {
      err.appendChild(errorBox(msg));
      err.scrollIntoView({ behavior: 'smooth', block: 'center' });
      focus?.focus();
    };
    if (!name.value.trim()) return fail('Napiš svoje jméno.', name);
    if (!/^[0-9]{4,6}$/.test(pin.value)) return fail('PIN musí mít 4 až 6 číslic.', pin);
    if (pin.value !== pin2.value) return fail('PINy se neshodují.', pin2);
    const g = gifts.read();
    if (!g.ok) return fail(g.problem ?? 'Zkontroluj dárky.');
    btn.disabled = true;
    try {
      const r = await api.register(code, name.value, pin.value, g.gifts);
      session.start(r.token, r.group_id, code);
      toast('Seznam je uložený. Vítej!');
      navigate('#/lide');
    } catch (ex) {
      fail(errorText(ex));
      btn.disabled = false;
    }
  };

  return el(
    'form',
    { class: 'stack', onSubmit: submit },
    el(
      'div',
      { class: 'card stack' },
      el('h2', {}, 'O tobě'),
      field('Jméno', name, `Musí být ve skupině „${preview.name}“ jedinečné.`),
      el('div', { class: 'row' }, el('div', { class: 'grow' }, field('PIN (4 až 6 číslic)', pin)), el('div', { class: 'grow' }, field('PIN znovu', pin2))),
      el('p', { class: 'muted small' }, 'PINem se budeš přihlašovat. Nepoužívej PIN od karty.'),
    ),
    el(
      'div',
      { class: 'card stack' },
      el('h2', {}, 'Co si přeješ'),
      el('p', { class: 'muted small' }, 'Aspoň tři dárky, později můžeš přidávat další. Odkaz na obchod ostatním ušetří hledání.'),
      gifts.root,
    ),
    err,
    btn,
  );
}

// ---------------------------------------------------------------------------
// Nová skupina
// ---------------------------------------------------------------------------

export async function renderCreateGroup(root: HTMLElement): Promise<void> {
  const err = el('div');
  const groupName = textInput({ placeholder: 'Např. Novákovi, Vánoce u babičky…', maxLength: 60 });
  const name = textInput({ placeholder: 'Jak ti ostatní říkají', autocomplete: 'name', maxLength: 40 });
  const pin = pinInput({ autocomplete: 'new-password' });
  const pin2 = pinInput({ autocomplete: 'new-password' });
  const gifts = giftListEditor(3);
  const btn = el('button', { class: 'btn block', type: 'submit' }, 'Založit skupinu');
  const main = el('main', { class: 'wrap plain' });

  const submit = async (e: Event) => {
    e.preventDefault();
    clear(err);
    const fail = (msg: string, focus?: HTMLElement) => {
      err.appendChild(errorBox(msg));
      err.scrollIntoView({ behavior: 'smooth', block: 'center' });
      focus?.focus();
    };
    if (!groupName.value.trim()) return fail('Pojmenuj skupinu.', groupName);
    if (!name.value.trim()) return fail('Napiš svoje jméno.', name);
    if (!/^[0-9]{4,6}$/.test(pin.value)) return fail('PIN musí mít 4 až 6 číslic.', pin);
    if (pin.value !== pin2.value) return fail('PINy se neshodují.', pin2);
    const g = gifts.read();
    if (!g.ok) return fail(g.problem ?? 'Zkontroluj dárky.');
    btn.disabled = true;
    try {
      const r = await api.createGroup(groupName.value, name.value, pin.value, g.gifts);
      const code = r.invite_code as string;
      session.start(r.token, r.group_id, code);
      clear(main);
      main.append(successCard(groupName.value.trim(), code));
      window.scrollTo(0, 0);
    } catch (ex) {
      fail(errorText(ex));
      btn.disabled = false;
    }
  };

  main.append(
    el(
      'form',
      { class: 'stack', onSubmit: submit },
      el(
        'div',
        { class: 'card stack' },
        el('h2', {}, 'Skupina'),
        field('Název skupiny', groupName),
      ),
      el(
        'div',
        { class: 'card stack' },
        el('h2', {}, 'O tobě'),
        field('Jméno', name),
        el('div', { class: 'row' }, el('div', { class: 'grow' }, field('PIN (4 až 6 číslic)', pin)), el('div', { class: 'grow' }, field('PIN znovu', pin2))),
      ),
      el(
        'div',
        { class: 'card stack' },
        el('h2', {}, 'Co si přeješ'),
        el('p', { class: 'muted small' }, 'Aspoň tři dárky. Později můžeš přidávat další.'),
        gifts.root,
      ),
      err,
      btn,
      el('a', { class: 'btn ghost block', href: '#/' }, 'Zpět na úvod'),
    ),
  );

  root.append(hero('Nová skupina', 'Ty začínáš, ostatní se přidají přes odkaz.'), main);
}

function successCard(groupName: string, code: string): HTMLElement {
  return el(
    'div',
    { class: 'stack', style: 'margin-top:8px' },
    el(
      'div',
      { class: 'card stack center' },
      el('span', { style: 'font-size:2.4rem', 'aria-hidden': 'true' }, '🎄'),
      el('h2', {}, `Skupina „${groupName}“ je založená`),
      el('p', { class: 'muted' }, 'Pošli rodině odkaz. Kdo ho otevře, napíše svoje přání a hned vidí ta tvoje.'),
      el('div', { class: 'code' }, code),
      el('p', { class: 'muted small', style: 'overflow-wrap:anywhere' }, inviteLink(code)),
      el('button', { class: 'btn block', onClick: () => void shareInvite(groupName, code) }, 'Sdílet pozvánku'),
      el('a', { class: 'btn secondary block', href: '#/lide' }, 'Pokračovat do aplikace'),
    ),
  );
}
