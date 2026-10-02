import DA_SDK from "https://da.live/nx/utils/sdk.js";
import { scanAccessibility } from "./utils.js";

// Formats issues found for display
function renderIssues(container, issues) {
  container.innerHTML = "";

  const heading = document.createElement("p");
  heading.className = "status";
  heading.textContent = issues.length
    ? `Found ${issues.length} accessibility issue${issues.length === 1 ? "" : "s"}`
    : "No accessibility issues found";
  container.append(heading);

  if (!issues.length) return;

  const list = document.createElement("ul");
  issues.forEach(({ rule, message }) => {
    const item = document.createElement("li");

    const ruleLabel = document.createElement("p");
    ruleLabel.className = "rule";
    ruleLabel.textContent = rule.replace(/-/g, " ");

    const messageText = document.createElement("p");
    messageText.className = "message";
    messageText.textContent = message;

    item.append(ruleLabel, messageText);
    list.append(item);
  });
  container.append(list);
}

(async function init() {
  // Debug: page context
  const { context, token } = await DA_SDK;
  console.log("ADA SCAN context", context);
  const { org, site, path } = context;
  const fullPath = `/${org}/${site}${path}`;

  const results = document.createElement("div");
  results.className = "results";
  results.innerHTML = "";

  // ADA Scan initialized
  const status = document.createElement("p");
  status.className = "status";
  status.textContent = "Scanning...";
  document.body.append(status);

  const { issues, message } = await scanAccessibility(fullPath, token);
  // Scan failed
  if (!issues) {
    status.textContent = message || "Scan failed.";
  } else {
    // Scan successful
    renderIssues(results, issues);
    status.textContent = "Scan Complete."
  }

  document.body.append(results);
})();
