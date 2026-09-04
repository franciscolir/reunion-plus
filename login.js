import { login, logout, restoreSession, isAuthenticated } from './auth.js';
import { isSupabaseConfigured } from './supabase-config.js?v=219';

const $ = (s, root = document) => root.querySelector(s);

async function init() {
  if (!isSupabaseConfigured()) {
    const gate = $('#loginGate');
    if (gate) gate.innerHTML = `<a href="./index.html" class="flex items-center justify-center gap-2 bg-primary text-on-primary px-8 py-3.5 rounded-xl font-label-lg text-label-lg hover:opacity-90 transition-all"><span class="material-symbols-outlined text-[22px]">login</span>Ir a la aplicación</a>`;
    return;
  }
  try {
    await restoreSession();
  } catch (e) { /* sin red: se muestra el formulario */ }
  if (isAuthenticated()) {
    window.location.replace('./index.html');
    return;
  }
  const startBtn = $('#loginStart');
  const form = $('#loginForm');
  const gate = $('#loginGate');
  const cancel = $('#loginCancel');
  const err = $('#loginError');
  startBtn.onclick = () => {
    gate.classList.add('hidden');
    form.classList.remove('hidden');
    $('#loginEmail')?.focus();
  };
  cancel.onclick = () => {
    form.classList.add('hidden');
    gate.classList.remove('hidden');
    if (err) err.classList.add('hidden');
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    const pass = $('#loginPass').value;
    if (!email || !pass) { showError(err, 'Completa correo y contraseña'); return; }
    const submit = $('#loginSubmit');
    submit.disabled = true;
    try {
      await login(email, pass);
      window.location.replace('./index.html');
    } catch (ex) {
      showError(err, 'No se pudo iniciar sesión: ' + (ex.message || ex));
      submit.disabled = false;
    }
  };
}

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

init();