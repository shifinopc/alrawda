// Light/dark theme: persisted in localStorage, applied as data-theme on <html>.
const KEY = 'stimes-theme';

export function getTheme() {
  return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
}

export function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
}

export function setTheme(t) {
  localStorage.setItem(KEY, t === 'dark' ? 'dark' : 'light');
  applyTheme(t);
}

export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

// Call once at startup (before render) to avoid a flash of the wrong theme.
export function initTheme() {
  applyTheme(getTheme());
}
