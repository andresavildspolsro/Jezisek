import './style.css';
import { ApiError, api, errorText, type GiftInput } from './api';
import { session } from './state';
import { clear, el, errorBox, openSheet, textInput, toast } from './ui';
import { renderCreateGroup, renderGroupEntry, renderLanding } from './auth';
import { renderApp } from './app';
import { authErrorText, emailFromJwt, heldAccount, pending, readCallback, setPassword } from './account';

const root = document.getElementById('app') as HTMLElement;

export function navigate(hash: string): void {
  if (location.hash === hash) {
    void route();
  } else {
    location.hash = hash;
  }
}

/**
 * Účet je ověřený; teď z něj udělat relaci aplikace. Buď se přihlásíme do
 * hotového profilu, dokončíme rozdělanou registraci, nebo účet připojíme ke
 * stávajícímu profilu.
 */
export async function resolveAccount(jwt: string): Promise<void> {
  const p = pending.take();
  heldAccount.set(jwt, emailFromJwt(jwt));
  try {
    if (p?.kind === 'link' && session.token) {
      await api.linkAuth(jwt, session.token);
      heldAccount.clear();
      toast('Účet je připojený.');
      navigate('#/ja');
      return;
    }

    const s = await api.sessionFromAuth(jwt);
    if (!s.needs_profile && s.token) {
      heldAccount.clear();
      session.start(s.token, s.group_id ?? '');
      toast('Vítej zpátky!');
      navigate('#/lide');
      return;
    }

    if (p?.kind === 'register' && p.code && p.name && p.gifts) {
      const r = await api.registerWithAuth(jwt, p.code, p.name, p.gifts as GiftInput[]);
      heldAccount.clear();
      session.start(r.token, r.group_id, p.code);
      toast('Seznam je uložený. Vítej!');
      navigate('#/lide');
      return;
    }

    if (p?.kind === 'create' && p.groupName && p.name && p.gifts) {
      const r = await api.createGroupWithAuth(jwt, p.groupName, p.name, p.gifts as GiftInput[]);
      heldAccount.clear();
      session.start(r.token, r.group_id, r.invite_code);
      navigate('#/pozvanka');
      return;
    }

    // Účet bez profilu: pošleme ho dokončit registraci do skupiny.
    if (session.lastCode) {
      toast('Účet je přihlášený, dokonči registraci.');
      navigate(`#/s/${session.lastCode}`);
    } else {
      toast('Účet je přihlášený. Otevři odkaz s pozvánkou a dokonči registraci.');
      navigate('#/');
    }
  } catch (e) {
    heldAccount.clear();
    toast(errorText(e), true);
    navigate('#/');
  }
}

/** Nastavení nového hesla po návratu z odkazu „zapomenuté heslo“. */
function newPasswordSheet(jwt: string): void {
  const p1 = textInput({ type: 'password', maxLength: 72, placeholder: 'Nové heslo', autocomplete: 'new-password' });
  const p2 = textInput({ type: 'password', maxLength: 72, placeholder: 'Heslo znovu', autocomplete: 'new-password' });
  const err = el('div');
  const save = el(
    'button',
    {
      class: 'btn block',
      onClick: async () => {
        clear(err);
        if (p1.value.length < 6) {
          err.appendChild(errorBox('Heslo musí mít aspoň 6 znaků.'));
          return;
        }
        if (p1.value !== p2.value) {
          err.appendChild(errorBox('Hesla se neshodují.'));
          return;
        }
        save.disabled = true;
        try {
          await setPassword(jwt, p1.value);
          close();
          toast('Heslo změněno.');
          await resolveAccount(jwt);
        } catch (e) {
          err.appendChild(errorBox(authErrorText(e)));
          save.disabled = false;
        }
      },
    },
    'Uložit heslo',
  );
  const close = openSheet([
    el('h2', {}, 'Nové heslo'),
    el('p', { class: 'muted small' }, 'Zadej heslo, kterým se budeš přihlašovat.'),
    p1,
    p2,
    err,
    save,
  ]);
  setTimeout(() => p1.focus(), 50);
}

async function route(): Promise<void> {
  const hash = location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('/').filter(Boolean);
  clear(root);
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 's' && parts[1]) {
      await renderGroupEntry(root, parts[1]);
    } else if (parts[0] === 'novy') {
      await renderCreateGroup(root);
    } else if (!session.token) {
      await renderLanding(root);
    } else {
      await renderApp(root, parts);
    }
  } catch (e) {
    if (e instanceof ApiError && e.code === 'unauthorized') {
      session.end();
      toast(errorText(e), true);
      navigate('#/');
      return;
    }
    clear(root);
    root.appendChild(
      el(
        'main',
        { class: 'wrap plain' },
        el(
          'div',
          { class: 'card stack', style: 'margin-top:24px' },
          el('h2', {}, 'Něco se pokazilo'),
          el('p', { class: 'muted' }, errorText(e)),
          el('button', { class: 'btn', onClick: () => void route() }, 'Zkusit znovu'),
        ),
      ),
    );
  }
}

/** Návrat od Googlu nebo z odkazu v e-mailu přijde ve fragmentu adresy. */
async function start(): Promise<void> {
  const cb = readCallback();
  if (cb && 'error' in cb) {
    pending.clear();
    toast(cb.error, true);
  } else if (cb) {
    if (cb.type === 'recovery') {
      await route();
      newPasswordSheet(cb.jwt);
      return;
    }
    await resolveAccount(cb.jwt);
    return;
  }
  await route();
}

// I změna adresy uvnitř otevřené aplikace může nést návrat od Googlu.
window.addEventListener('hashchange', () => void start());
void start();
