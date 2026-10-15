// Sign in and sign up.
import { api } from '../api.js';
import { go, refreshMe, state } from '../app.js';
import { formData, html } from '../dom.js';

export async function authScreen(view: HTMLElement, params: string[]) {
  if (state.me || (await refreshMe())) return go('#/today');
  const signup = params[0] === 'signup';
  view.innerHTML = html`<div style="max-width:440px;margin:24px auto">
  <a class="wordmark" href="/">KYVO</a>
  <p class="eyebrow" style="margin-top:22px">TRAIN SMARTER. GET STRONGER.</p>
  <h1>${signup ? 'Create your free account' : 'Welcome back'}</h1>
  <p class="muted">${signup ? 'Your personalised Daily Plan is about two minutes away.' : 'Sign in to see today’s plan.'}</p>
  <form class="card" novalidate>
    <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required></div>
    <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="${signup ? 10 : 1}" required aria-describedby="pw-hint">
      ${signup ? html`<p class="hint" id="pw-hint">At least 10 characters.</p>` : ''}</div>
    ${signup ? html`
      <label class="check"><input type="checkbox" name="ageConfirmed" required> I am 18 or older.</label>
      <label class="check"><input type="checkbox" name="acceptTerms" required> I agree to the <a href="/legal/terms" target="_blank">Terms</a> and <a href="/legal/privacy" target="_blank">Privacy Policy</a>, and understand KYVO gives general fitness information, not medical advice (<a href="/legal/disclaimer" target="_blank">disclaimer</a>).</label>
      <label class="check"><input type="checkbox" name="analyticsConsent"> Optional: help improve KYVO with privacy-friendly usage measurement. Your health, food and workout data is never shared with advertisers.</label>` : ''}
    <p class="error-text" role="alert" id="err" hidden></p>
    <button class="btn btn-primary btn-block" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
  </form>
  <p class="muted" style="text-align:center">${signup ? html`Already have an account? <a href="#/login">Sign in</a>` : html`New to KYVO? <a href="#/signup">Create a free account</a>`}</p>
  </div>`.value;
  const form = view.querySelector('form')!;
  const err = view.querySelector<HTMLElement>('#err')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const f = formData(form);
    const btn = form.querySelector('button')!;
    btn.disabled = true;
    try {
      if (signup) {
        if (!f.ageConfirmed) throw new Error('You need to be 18 or older to use KYVO.');
        if (!f.acceptTerms) throw new Error('Please accept the Terms and Privacy Policy to continue.');
        await api.post('/api/auth/register', { email: f.email, password: f.password, ageConfirmed: true, acceptTerms: true, analyticsConsent: !!f.analyticsConsent });
      } else {
        await api.post('/api/auth/login', { email: f.email, password: f.password });
      }
      await refreshMe();
      go(state.me?.onboarded ? '#/today' : '#/onboarding');
    } catch (ex) {
      err.textContent = (ex as Error).message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
}
