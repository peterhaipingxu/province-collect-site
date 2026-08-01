/* Province-Collect client-side access gate.
   GitHub Pages is static hosting: this delays normal loading but is not server-side access control. */
(() => {
  'use strict';

  const ACCESS_KEY = 'province-collect-access-v1';
  const EXPECTED_HASH = '158a323a7ba44870f23d96f1516dd70aa48e9a72db4ebb026b0a89e212a208ab';
  const bootstrap = document.currentScript;
  const coreSrc = bootstrap?.dataset.coreSrc || '';
  const appSrc = bootstrap?.dataset.appSrc || '';
  const lock = document.getElementById('site-lock');
  const form = document.getElementById('site-lock-form');
  const input = document.getElementById('site-password');
  const submit = document.getElementById('site-lock-submit');
  const error = document.getElementById('site-lock-error');
  let loading = null;

  function sessionAllowed() {
    try { return sessionStorage.getItem(ACCESS_KEY) === '1'; }
    catch (_) { return false; }
  }

  function rememberSession() {
    try { sessionStorage.setItem(ACCESS_KEY, '1'); }
    catch (_) { /* The gate still works when storage is unavailable. */ }
  }

  function forgetSession() {
    try { sessionStorage.removeItem(ACCESS_KEY); }
    catch (_) { /* Nothing else to clean up. */ }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (!src) { reject(new Error('missing script source')); return; }
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`failed to load ${src}`));
      document.body.appendChild(script);
    });
  }

  function setBusy(isBusy) {
    if (!submit || !input) return;
    submit.disabled = isBusy;
    input.disabled = isBusy;
    submit.textContent = isBusy ? '正在进入…' : '进入网站';
  }

  function showError(message) {
    if (error) error.textContent = message;
    if (form) {
      form.classList.remove('is-error');
      void form.offsetWidth;
      form.classList.add('is-error');
    }
  }

  async function digest(value) {
    if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
      throw new Error('当前浏览器不支持安全密码校验');
    }
    const bytes = new TextEncoder().encode(value);
    const result = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function activateSite() {
    if (loading) return loading;
    setBusy(true);
    loading = loadScript(coreSrc)
      .then(() => loadScript(appSrc))
      .then(() => {
        document.body.classList.remove('site-locked');
        if (lock) lock.hidden = true;
        document.getElementById('app')?.focus({ preventScroll: true });
      })
      .catch((loadError) => {
        loading = null;
        forgetSession();
        document.body.classList.add('site-locked');
        if (lock) lock.hidden = false;
        setBusy(false);
        showError('网站数据加载失败，请刷新后重试。');
        console.error('Province-Collect failed to load after unlock:', loadError);
      });
    return loading;
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input || input.disabled) return;
    setBusy(true);
    if (error) error.textContent = '';
    try {
      if (await digest(input.value) !== EXPECTED_HASH) {
        setBusy(false);
        input.value = '';
        showError('密码错误，请重试。');
        input.focus();
        return;
      }
      rememberSession();
      await activateSite();
    } catch (digestError) {
      setBusy(false);
      showError(digestError.message || '密码校验失败，请重试。');
    }
  });

  if (sessionAllowed()) activateSite();
  else input?.focus();
})();
