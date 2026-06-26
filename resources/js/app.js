import './bootstrap';
import Alpine from 'alpinejs';

window.Alpine = Alpine;

Alpine.data('toastHost', () => ({
  toasts: [],
  push(message, type = 'success') {
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
    this.toasts.push({ id, message, type });
    setTimeout(() => this.remove(id), 2600);
  },
  remove(id) {
    this.toasts = this.toasts.filter(t => t.id !== id);
  },
}));

Alpine.start();
