import './style.css';
import { ApiError, errorText } from './api';
import { session } from './state';
import { clear, el, toast } from './ui';
import { renderCreateGroup, renderGroupEntry, renderLanding } from './auth';
import { renderApp } from './app';

const root = document.getElementById('app') as HTMLElement;

export function navigate(hash: string): void {
  if (location.hash === hash) {
    void route();
  } else {
    location.hash = hash;
  }
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

window.addEventListener('hashchange', () => void route());
void route();
