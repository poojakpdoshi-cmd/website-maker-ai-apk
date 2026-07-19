import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './nexora-theme.css';

const isAndroid = /Android/i.test(navigator.userAgent);

function updateViewportHeight() {
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;

  document.documentElement.style.setProperty(
    '--nexora-viewport-height',
    `${Math.round(viewportHeight)}px`
  );
}

function keepFocusedFieldVisible() {
  if (!isAndroid) return;

  const activeElement = document.activeElement;

  if (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLSelectElement ||
    (activeElement instanceof HTMLElement && activeElement.isContentEditable)
  ) {
    window.setTimeout(() => {
      activeElement.scrollIntoView({ block: 'center', inline: 'nearest' });
    }, 120);
  }
}

updateViewportHeight();

window.addEventListener('resize', updateViewportHeight);
window.visualViewport?.addEventListener('resize', () => {
  updateViewportHeight();
  keepFocusedFieldVisible();
});
document.addEventListener('focusin', keepFocusedFieldVisible);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import './chat-studio.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}


import './cms-studio.css';

const nexoraUiVersion = '4.3.0';

if (localStorage.getItem('nexora-ui-version') !== nexoraUiVersion) {
  localStorage.removeItem('nexora-active-generation-job');
  localStorage.setItem('nexora-ui-version', nexoraUiVersion);

  if ('caches' in window) {
    void caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    );
  }
}

import './nexora-app-shell.css';
