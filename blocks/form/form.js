import fetchConfig from '../../scripts/config.js';
import verifyRecaptcha from '../../scripts/recaptcha-verify.js';

const RECAPTCHA_API_SRC = 'https://www.google.com/recaptcha/api.js?onload=onRecaptchaApiLoad&render=explicit';

let apiPromise;

/**
 * Loads Google's reCAPTCHA API script once per page — subsequent calls
 * (including from other Form block instances on the same page) share the
 * same promise. Uses explicit rendering so each block instance renders its
 * own widget and tracks its own widget id independently, rather than
 * relying on implicit auto-render's single global widget id.
 * @returns {Promise<object>} The grecaptcha global, once ready
 */
function loadRecaptchaApi() {
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      window.onRecaptchaApiLoad = () => resolve(window.grecaptcha);
      const script = document.createElement('script');
      script.src = RECAPTCHA_API_SRC;
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error('Failed to load the reCAPTCHA script'));
      document.head.append(script);
    });
  }
  return apiPromise;
}

/**
 * @param {Element} [row] An authored row
 * @returns {string} Its trimmed text content, or '' if the row is absent
 */
function textOf(row) {
  return row?.textContent.trim() || '';
}

/**
 * @param {Element} status The form's status <p>
 * @param {string} message Text to show; hides the element when empty
 */
function setStatus(status, message) {
  status.textContent = message;
  status.hidden = !message;
}

/**
 * Builds the actual <form> markup: Name/Email/Message fields, a container
 * for the reCAPTCHA widget, and a submit button. These three input fields
 * are intentionally fixed, not author-configurable — this block
 * demonstrates CAPTCHA-gated submission, not a general-purpose form
 * builder.
 * @returns {Element} The <form> element, not yet wired up
 */
function buildForm() {
  const form = document.createElement('form');

  [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'email', label: 'Email', type: 'email' },
  ].forEach(({ name, label, type }) => {
    const field = document.createElement('div');
    field.className = 'form-field';
    const labelEl = document.createElement('label');
    labelEl.htmlFor = `form-${name}`;
    labelEl.textContent = label;
    const input = document.createElement('input');
    input.type = type;
    input.id = `form-${name}`;
    input.name = name;
    input.required = true;
    field.append(labelEl, input);
    form.append(field);
  });

  const messageField = document.createElement('div');
  messageField.className = 'form-field';
  const messageLabel = document.createElement('label');
  messageLabel.htmlFor = 'form-message';
  messageLabel.textContent = 'Message';
  const messageInput = document.createElement('textarea');
  messageInput.id = 'form-message';
  messageInput.name = 'message';
  messageInput.rows = 5;
  messageInput.required = true;
  messageField.append(messageLabel, messageInput);
  form.append(messageField);

  const recaptchaField = document.createElement('div');
  recaptchaField.className = 'form-recaptcha';
  form.append(recaptchaField);

  const status = document.createElement('p');
  status.className = 'form-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  form.append(status);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'button primary';
  submit.textContent = 'Submit';
  // stays disabled until the reCAPTCHA widget has actually loaded (see
  // initRecaptcha) — there's no valid way to submit before then anyway
  submit.disabled = true;
  form.append(submit);

  return form;
}

/**
 * Wires up the form's submit flow: reads the reCAPTCHA token, sends it (and
 * the form's field values) to the verify proxy, and either shows a success
 * message, redirects to the CAPTCHA error page, or shows an inline error —
 * gating form processing on a server-verified human check.
 * @param {Element} form The form built by buildForm
 * @param {number} widgetId The rendered reCAPTCHA widget's id
 * @param {string} successMessage Shown on a verified submission
 * @param {string} [errorPageHref] Redirect target on failed verification
 */
function wireSubmit(form, widgetId, successMessage, errorPageHref) {
  const status = form.querySelector('.form-status');
  const submit = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus(status, '');

    const token = window.grecaptcha.getResponse(widgetId);
    if (!token) {
      setStatus(status, 'Please complete the reCAPTCHA challenge before submitting.');
      return;
    }

    const fields = Object.fromEntries(new FormData(form).entries());
    submit.disabled = true;
    setStatus(status, 'Submitting…');

    let result;
    try {
      result = await verifyRecaptcha(token, fields);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Form: reCAPTCHA verification request failed', error);
      window.grecaptcha.reset(widgetId);
      submit.disabled = false;
      setStatus(status, 'Something went wrong verifying your submission. Please try again.');
      return;
    }

    if (!result.success) {
      if (errorPageHref) {
        window.location.href = errorPageHref;
        return;
      }
      window.grecaptcha.reset(widgetId);
      submit.disabled = false;
      setStatus(status, 'We could not verify you are human. Please try again.');
      return;
    }

    form.reset();
    window.grecaptcha.reset(widgetId);
    submit.disabled = false;
    setStatus(status, successMessage);
  });
}

/**
 * Fetches the config sheet and loads Google's reCAPTCHA script, renders
 * the widget, and wires up the submit flow. Deferred out of decorate()
 * (see the IntersectionObserver below) so a form below the fold doesn't
 * force Google's reCAPTCHA script/iframe into the page's critical
 * loading path — eager-loading it measurably hurts LCP.
 * @param {Element} form The form built by buildForm
 * @param {string} successMessage Shown on a verified submission
 * @param {string} [errorPageHref] Redirect target on failed verification
 */
async function initRecaptcha(form, successMessage, errorPageHref) {
  const recaptchaField = form.querySelector('.form-recaptcha');
  const submit = form.querySelector('button[type="submit"]');

  let widgetId;
  try {
    const config = await fetchConfig();
    const siteKey = config['recaptcha-site-key'];
    if (!siteKey) throw new Error('recaptcha-site-key is not set in the config sheet');
    const grecaptcha = await loadRecaptchaApi();
    widgetId = grecaptcha.render(recaptchaField, { sitekey: siteKey });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Form: reCAPTCHA is not available', error);
    recaptchaField.textContent = 'reCAPTCHA is not configured for this form.';
    return;
  }

  submit.disabled = false;
  wireSubmit(form, widgetId, successMessage, errorPageHref);
}

/**
 * loads and decorates the block: renders a Name/Email/Message form gated by
 * a Google reCAPTCHA v2 checkbox. The site key comes from the site's config
 * sheet (see scripts/config.js) — it's public, so it's safe to ship
 * client-side; verification happens server-side via
 * scripts/recaptcha-verify.js, which never sees the secret key either.
 *
 * Authored content is read positionally, one row per field:
 *   row 1: Title (text)
 *   row 2: Description (rich text)
 *   row 3: Success message (text)
 *   row 4: Error page (a link, followed on failed verification)
 * @param {Element} block The form block element
 */
export default function decorate(block) {
  const rows = [...block.children];
  const title = textOf(rows[0]);
  const description = rows[1];
  const successMessage = textOf(rows[2]) || 'Thanks — your message has been received.';
  const errorPageHref = rows[3]?.querySelector('a')?.getAttribute('href');

  block.textContent = '';

  if (title) {
    const heading = document.createElement('h2');
    heading.textContent = title;
    block.append(heading);
  }
  if (description?.textContent.trim()) {
    const desc = document.createElement('div');
    desc.className = 'form-description';
    desc.append(...description.childNodes);
    block.append(desc);
  }

  const form = buildForm();
  block.append(form);

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    initRecaptcha(form, successMessage, errorPageHref);
  }, { rootMargin: '200px' });
  observer.observe(block);
}
