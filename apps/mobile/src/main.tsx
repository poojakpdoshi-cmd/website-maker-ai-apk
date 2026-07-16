import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './webforge-theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import './webforge-final-ui.css';
import './chat-studio.css';
import './webforge-v43-performance.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}


import './cms-studio.css';

const webforgeUiVersion = '4.3.0';

if (localStorage.getItem('webforge-ui-version') !== webforgeUiVersion) {
  localStorage.removeItem('webforge-active-generation-job');
  localStorage.setItem('webforge-ui-version', webforgeUiVersion);

  if ('caches' in window) {
    void caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    );
  }
}
