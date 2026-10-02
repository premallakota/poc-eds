import DA_SDK from "https://da.live/nx/utils/sdk.js";
import { buildDiffLinks } from "./utils.js";

// Creates a labeled row with a link and a copy-to-clipboard button
function renderLinkRow(container, label, url) {
  const row = document.createElement("div");
  row.className = "link-row";

  const labelEl = document.createElement("span");
  labelEl.className = "link-label";
  labelEl.textContent = label;

  const link = document.createElement("a");
  link.className = "link-url";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = url;

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "copy-button";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(url);
    copyButton.textContent = "Copied!";
    setTimeout(() => { copyButton.textContent = "Copy"; }, 1500);
  });

  row.append(labelEl, link, copyButton);
  container.append(row);
}

(async function init() {
  const { context } = await DA_SDK;
  const {
    org, repo, path, ref,
  } = context;

  const { diffSiteUrl, previewUrl, liveUrl } = buildDiffLinks({
    org, site: repo, path, ref,
  });

  const container = document.createElement("div");
  container.className = "diff-checker";

  const intro = document.createElement("p");
  intro.className = "intro";
  intro.textContent = "Compare the preview and live versions of this page:";
  container.append(intro);

  renderLinkRow(container, "Diff", diffSiteUrl);
  renderLinkRow(container, "Preview", previewUrl);
  renderLinkRow(container, "Live", liveUrl);

  document.body.append(container);
})();
