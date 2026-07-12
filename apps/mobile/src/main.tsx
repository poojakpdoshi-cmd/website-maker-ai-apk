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

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}


import './cms-studio.css';
