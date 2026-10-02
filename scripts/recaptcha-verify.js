/**
 * Client-side half of reCAPTCHA verification, proxied through a small
 * Vercel serverless function deployed from the aig-aem-eds-poc repo — the
 * Google siteverify call requires a secret key that must never reach the
 * browser, so this module never talks to Google directly. A single-purpose
 * fetch wrapper that throws on failure rather than swallowing errors.
 */

const RECAPTCHA_VERIFY_URL = 'https://aig-aem-eds-poc.vercel.app/api/recaptcha-verify';

/**
 * @typedef {object} RecaptchaVerifyResult
 * @property {boolean} success Whether Google confirmed the token as human
 * @property {string[]} [errorCodes] Google's error-codes, when unsuccessful
 */

/**
 * Submits the reCAPTCHA response token (and the form's own field values,
 * logged server-side on success) to the verify proxy.
 * @param {string} token The token from grecaptcha.getResponse()
 * @param {Record<string, string>} fields The form's other field values
 * @returns {Promise<RecaptchaVerifyResult>} The verification outcome
 * @throws {Error} If the request itself fails (network error, non-2xx)
 */
export default async function verifyRecaptcha(token, fields) {
  const res = await fetch(RECAPTCHA_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, fields }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error?.message || `${RECAPTCHA_VERIFY_URL} returned ${res.status}`);
  }
  return body;
}
