/**
 * Site-wide config, authored as a DA "Sheet" resource and published to
 * /config.json — holds only non-secret, publicly-shippable values: a
 * published sheet's .json endpoint is unauthenticated, exactly like
 * query-index.json, so nothing placed here can be a secret.
 */

const CONFIG_PATH = '/config.json';

let configPromise;

/**
 * Loads /config.json once, caching the in-flight/completed request so
 * repeated calls from multiple blocks on the same page share one fetch.
 * Expects the sheet's columns to be named Key/Value (the same convention
 * used by placeholders sheets elsewhere in the AEM/EDS ecosystem).
 * @returns {Promise<Record<string, string>>} Config key/value pairs
 */
export default function fetchConfig() {
  if (!configPromise) {
    configPromise = fetch(CONFIG_PATH)
      .then((res) => {
        if (!res.ok) throw new Error(`${CONFIG_PATH} returned ${res.status}`);
        return res.json();
      })
      .then((json) => Object.fromEntries(
        (json.data || []).map((row) => [row.Key, row.Value]),
      ))
      .catch((error) => {
        configPromise = null; // allow a retry on the next call
        throw error;
      });
  }
  return configPromise;
}
