import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './nexora-theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import './nexora-final-ui.css';
import './chat-studio.css';
import './nexora-v43-performance.css';

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
