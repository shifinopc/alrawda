import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider, ConfirmProvider } from './components/ui';
import { initTheme } from './theme';
import './styles.css';

initTheme();

// Number inputs change value on mouse wheel while focused (browser default) —
// blur them on wheel so scrolling the page never edits an amount.
document.addEventListener('wheel', () => {
  const el = document.activeElement;
  if (el && el.tagName === 'INPUT' && el.type === 'number') el.blur();
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
