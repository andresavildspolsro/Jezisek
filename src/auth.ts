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
  mount,
  pinInput,
  shareInvite,
  textInput,
  toast,
} from './ui';
import { navigate, resolveAccount } from './main';
import { authErrorText, googleUrl, heldAccount, pending, sendRecovery, signIn, signUp } from './account';

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

/** Jak se člověk bude přihlašovat. */
type Method = 'pin' | 'email' | 'google';

function methodPicker(onChange: (m: Method) => void): { root: HTMLElement; get: () => Method } {
  let value: Method = 'pin';
  const labels: [Method, string][] = [
    ['pin', 'PIN'],
    ['email', 'E-mail'],
    ['google', 'Google'],
  ];
  const buttons = labels.map(([m, label]) =>
    el(
      'button',
      {
        type: 'button',
        role: 'tab',
        'aria-selected': String(value === m),
        onClick: () => {
          value = m;
          buttons.forEach((b, i) => b.setAttribute('aria-selected', String(labels[i][0] === m)));
          onChange(m);
        },
      },
      label,
    ),
  );
  return { root: el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Způsob přihlášení' }, ...buttons), get: () => value };
}

function googleButton(label: string, before?: () => void): HTMLElement {
  return el(
    'button',
    {
      type: 'button',
      class: 'btn light block',
      style: 'border-color:var(--line);border-width:1px',
      onClick: () => {
        before?.();
        location.href = googleUrl();
      },
    },
    el('span', { 'aria-hidden': 'true' }, 'G'),
    label,
  );
}

function separator(text: string): HTMLElement {
  return el('div', { class: 'muted small center' }, text);
}

function emailField(): HTMLInputElement {
  return textInput({ type: 'email', placeholder: 'tvuj@email.cz', autocomplete: 'email', maxLength: 120 });
}

function passwordField(neu = false): HTMLInputElement {
  return textInput({
    type: 'password',
    placeholder: neu ? 'Aspoň 6 znaků' : 'Heslo',
    autocomplete: neu ? 'new-password' : 'current-password',
    maxLength: 72,
  });
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
    'div',
    { class: 'stack' },
    el(
      'form',
      { class: 'card stack', onSubmit: submit },
      field('Kdo jsi', select),
      field('PIN', pin),
      err,
      btn,
      el('p', { class: 'muted small center' }, 'Zapomenutý PIN ti může nastavit správce aplikace.'),
    ),
    accountLoginCard(),
  );
}

/** Přihlášení účtem: e-mailem s heslem, nebo Googlem. */
function accountLoginCard(): HTMLElement {
  const err = el('div');
  const email = emailField();
  const password = passwordField();
  const form = el('div', { class: 'stack' }, field('E-mail', email), field('Heslo', password));
  form.hidden = true;

  const btn = el(
    'button',
    {
      type: 'button',
      class: 'btn secondary block',
      onClick: async () => {
        clear(err);
        if (form.hidden) {
          // Popisek zůstává stejný, ať se neplete s přihlášením PINem.
          form.hidden = false;
          setTimeout(() => email.focus(), 30);
          return;
        }
        if (!email.value.trim() || !password.value) {
          mount(err, errorBox('Vyplň e-mail i heslo.'));
          return;
        }
        btn.disabled = true;
        try {
          const jwt = await signIn(email.value, password.value);
          await resolveAccount(jwt);
        } catch (ex) {
          mount(err, errorBox(authErrorText(ex)));
          btn.disabled = false;
        }
      },
    },
    'Přihlásit se e-mailem',
  );

  const forgot = el(
    'button',
    {
      type: 'button',
      class: 'btn ghost small',
      onClick: async () => {
        clear(err);
        if (!email.value.trim()) {
          form.hidden = false;
          mount(err, errorBox('Nejdřív napiš svůj e-mail.'));
          email.focus();
          return;
        }
        try {
          await sendRecovery(email.value);
          toast('Poslali jsme ti odkaz na nové heslo.');
        } catch (ex) {
          mount(err, errorBox(authErrorText(ex)));
        }
      },
    },
    'Zapomenuté heslo',
  );

  return el(
    'div',
    { class: 'card stack' },
    separator('nebo účtem'),
    googleButton('Pokračovat přes Google'),
    form,
    err,
    btn,
    forgot,
  );
}

function registerForm(preview: GroupPreview, code: string): HTMLElement {
  const err = el('div');
  const name = textInput({ placeholder: 'Jak ti ostatní říkají', autocomplete: 'name', maxLength: 40 });
  const gifts = giftListEditor(3);
  const held = heldAccount.get();

  const pin = pinInput({ autocomplete: 'new-password' });
  const pin2 = pinInput({ autocomplete: 'new-password' });
  const email = emailField();
  const password = passwordField(true);

  const pinBox = el(
    'div',
    { class: 'stack' },
    el('div', { class: 'row' }, el('div', { class: 'grow' }, field('PIN (4 až 6 číslic)', pin)), el('div', { class: 'grow' }, field('PIN znovu', pin2))),
    el('p', { class: 'muted small' }, 'PINem se budeš přihlašovat. Nepoužívej PIN od karty.'),
  );
  const emailBox = el(
    'div',
    { class: 'stack' },
    field('E-mail', email),
    field('Heslo', password, 'Aspoň 6 znaků. Na e-mail si pak můžeš posílat seznamy.'),
  );
  const googleBox = el('p', { class: 'muted small' }, 'Přesměrujeme tě na Google a pak se sem vrátíš. Přání máš mezitím uložená.');
  emailBox.hidden = true;
  googleBox.hidden = true;

  const btn = el('button', { class: 'btn block', type: 'submit' }, 'Vytvořit můj seznam');
  const picker = methodPicker((m) => {
    pinBox.hidden = m !== 'pin';
    emailBox.hidden = m !== 'email';
    googleBox.hidden = m !== 'google';
    btn.textContent = m === 'google' ? 'Pokračovat přes Google' : 'Vytvořit můj seznam';
  });

  const fail = (msg: string, focus?: HTMLElement) => {
    mount(err, errorBox(msg));
    err.scrollIntoView({ behavior: 'smooth', block: 'center' });
    focus?.focus();
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    clear(err);
    if (!name.value.trim()) return fail('Napiš svoje jméno.', name);
    const g = gifts.read();
    if (!g.ok) return fail(g.problem ?? 'Zkontroluj dárky.');
    const method: Method = held ? 'email' : picker.get();

    if (!held && method === 'pin') {
      if (!/^[0-9]{4,6}$/.test(pin.value)) return fail('PIN musí mít 4 až 6 číslic.', pin);
      if (pin.value !== pin2.value) return fail('PINy se neshodují.', pin2);
    }
    if (!held && method === 'email') {
      if (!email.value.includes('@')) return fail('Zkontroluj e-mail.', email);
      if (password.value.length < 6) return fail('Heslo musí mít aspoň 6 znaků.', password);
    }

    btn.disabled = true;
    try {
      if (held) {
        const r = await api.registerWithAuth(held.jwt, code, name.value, g.gifts);
        heldAccount.clear();
        session.start(r.token, r.group_id, code);
        toast('Seznam je uložený. Vítej!');
        navigate('#/lide');
        return;
      }
      if (method === 'pin') {
        const r = await api.register(code, name.value, pin.value, g.gifts);
        session.start(r.token, r.group_id, code);
        toast('Seznam je uložený. Vítej!');
        navigate('#/lide');
        return;
      }
      // Účet: přání si schováme a dokončíme registraci po ověření.
      pending.set({ kind: 'register', code, name: name.value, gifts: g.gifts });
      if (method === 'google') {
        location.href = googleUrl();
        return;
      }
      const { jwt } = await signUp(email.value, password.value);
      if (jwt) {
        await resolveAccount(jwt);
      } else {
        clear(err);
        mount(
          err,
          el('div', { class: 'notice' }, `Poslali jsme ti e-mail na ${email.value.trim()}. Klepni v něm na odkaz a seznam se uloží.`),
        );
        btn.disabled = true;
      }
    } catch (ex) {
      pending.clear();
      fail(ex instanceof ApiError ? errorText(ex) : authErrorText(ex));
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
      held
        ? el('div', { class: 'notice' }, `Jsi přihlášený jako ${held.email ?? 'účet'}. Zbývá napsat jméno a přání.`)
        : el('div', { class: 'stack' }, el('span', { class: 'hint' }, 'Jak se budeš přihlašovat'), picker.root, pinBox, emailBox, googleBox),
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
  if (session.token) {
    await renderCreateGroupAsMember(root, session.token);
    return;
  }
  const err = el('div');
  const groupName = textInput({ placeholder: 'Např. Novákovi, Vánoce u babičky…', maxLength: 60 });
  const name = textInput({ placeholder: 'Jak ti ostatní říkají', autocomplete: 'name', maxLength: 40 });
  const pin = pinInput({ autocomplete: 'new-password' });
  const pin2 = pinInput({ autocomplete: 'new-password' });
  const email = emailField();
  const password = passwordField(true);
  const gifts = giftListEditor(3);
  const btn = el('button', { class: 'btn block', type: 'submit' }, 'Založit skupinu');
  const main = el('main', { class: 'wrap plain' });
  const held = heldAccount.get();

  const pinBox = el(
    'div',
    { class: 'row' },
    el('div', { class: 'grow' }, field('PIN (4 až 6 číslic)', pin)),
    el('div', { class: 'grow' }, field('PIN znovu', pin2)),
  );
  const emailBox = el('div', { class: 'stack' }, field('E-mail', email), field('Heslo', password, 'Aspoň 6 znaků.'));
  const googleBox = el('p', { class: 'muted small' }, 'Přesměrujeme tě na Google a pak se sem vrátíš.');
  emailBox.hidden = true;
  googleBox.hidden = true;
  const picker = methodPicker((m) => {
    pinBox.hidden = m !== 'pin';
    emailBox.hidden = m !== 'email';
    googleBox.hidden = m !== 'google';
    btn.textContent = m === 'google' ? 'Pokračovat přes Google' : 'Založit skupinu';
  });

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
    const g = gifts.read();
    if (!g.ok) return fail(g.problem ?? 'Zkontroluj dárky.');
    const method: Method = held ? 'email' : picker.get();
    if (!held && method === 'pin') {
      if (!/^[0-9]{4,6}$/.test(pin.value)) return fail('PIN musí mít 4 až 6 číslic.', pin);
      if (pin.value !== pin2.value) return fail('PINy se neshodují.', pin2);
    }
    if (!held && method === 'email') {
      if (!email.value.includes('@')) return fail('Zkontroluj e-mail.', email);
      if (password.value.length < 6) return fail('Heslo musí mít aspoň 6 znaků.', password);
    }

    btn.disabled = true;
    try {
      if (held || method !== 'pin') {
        if (held) {
          const r = await api.createGroupWithAuth(held.jwt, groupName.value, name.value, g.gifts);
          heldAccount.clear();
          session.start(r.token, r.group_id, r.invite_code);
          clear(main);
          main.append(successCard(groupName.value.trim(), r.invite_code as string));
          window.scrollTo(0, 0);
          return;
        }
        pending.set({ kind: 'create', groupName: groupName.value, name: name.value, gifts: g.gifts });
        if (method === 'google') {
          location.href = googleUrl();
          return;
        }
        const { jwt } = await signUp(email.value, password.value);
        if (jwt) {
          await resolveAccount(jwt);
        } else {
          clear(err);
          mount(err, el('div', { class: 'notice' }, `Poslali jsme ti e-mail na ${email.value.trim()}. Klepni v něm na odkaz a skupina se založí.`));
        }
        return;
      }
      const r = await api.createGroup(groupName.value, name.value, pin.value, g.gifts);
      const code = r.invite_code as string;
      session.start(r.token, r.group_id, code);
      clear(main);
      main.append(successCard(groupName.value.trim(), code));
      window.scrollTo(0, 0);
    } catch (ex) {
      pending.clear();
      fail(ex instanceof ApiError ? errorText(ex) : authErrorText(ex));
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
        held
          ? el('div', { class: 'notice' }, `Jsi přihlášený jako ${held.email ?? 'účet'}.`)
          : el('div', { class: 'stack' }, el('span', { class: 'hint' }, 'Jak se budeš přihlašovat'), picker.root, pinBox, emailBox, googleBox),
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

/** Další skupina pro už přihlášeného člověka: jen název, přání zůstávají jedna. */
async function renderCreateGroupAsMember(root: HTMLElement, token: string): Promise<void> {
  const err = el('div');
  const groupName = textInput({ placeholder: 'Např. Kolegové, Kamarádi z hor…', maxLength: 60 });
  const btn = el('button', { class: 'btn block', type: 'submit' }, 'Založit skupinu');
  const main = el('main', { class: 'wrap plain' });
  let me: { name: string; children: { name: string }[] } | null = null;
  try {
    me = await api.me(token);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'unauthorized') {
      session.end();
      navigate('#/novy');
      return;
    }
    throw e;
  }
  const kids = me.children.map((c) => c.name);

  const submit = async (e: Event) => {
    e.preventDefault();
    clear(err);
    if (!groupName.value.trim()) {
      err.appendChild(errorBox('Pojmenuj skupinu.'));
      groupName.focus();
      return;
    }
    btn.disabled = true;
    try {
      const r = await api.createGroupAsMember(token, groupName.value);
      session.selectGroup(r.group_id, r.invite_code);
      clear(main);
      main.append(successCard(r.name, r.invite_code));
      window.scrollTo(0, 0);
    } catch (ex) {
      err.appendChild(errorBox(errorText(ex)));
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
        el('h2', {}, 'Další skupina'),
        el(
          'p',
          { class: 'muted small' },
          `Nová skupina dostane vlastní kód pozvánky, takže nemusíš nikomu dávat odkaz na svou stávající skupinu. Přidáš se do ní jako ${me.name}`,
          kids.length ? ` i s dětmi (${kids.join(', ')})` : '',
          '. Tvůj seznam přání zůstává jeden a tentýž: co si přeješ a co už je koupené, platí ve všech skupinách.',
        ),
        field('Název skupiny', groupName),
      ),
      err,
      btn,
      el('a', { class: 'btn ghost block', href: '#/ja' }, 'Zpět'),
    ),
  );
  root.append(hero('Nová skupina', 'Další okruh lidí, další pozvánka.'), main);
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
