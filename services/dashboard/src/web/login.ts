import './styles.css';

const form = document.getElementById('login-form');
const passwordInput = document.getElementById('password');
const errorEl = document.getElementById('login-error');

if (form instanceof HTMLFormElement && passwordInput instanceof HTMLInputElement && errorEl) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    errorEl.hidden = true;

    void fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: passwordInput.value }),
    }).then((response) => {
      if (response.status === 204) {
        window.location.href = '/';
        return;
      }
      errorEl.hidden = false;
      passwordInput.value = '';
      passwordInput.focus();
    });
  });
}
