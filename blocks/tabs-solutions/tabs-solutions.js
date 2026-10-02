// eslint-disable-next-line import/no-unresolved
import { toClassName } from '../../scripts/aem.js';

export default async function decorate(block) {
  // build tablist
  const tablist = document.createElement('div');
  tablist.className = 'tabs-solutions-list';
  tablist.setAttribute('role', 'tablist');

  // decorate tabs and tabpanels
  const tabs = [...block.children].map((child) => child.firstElementChild);
  tabs.forEach((tab, i) => {
    const id = toClassName(tab.textContent);

    // decorate tabpanel
    const tabpanel = block.children[i];
    tabpanel.className = 'tabs-solutions-panel';
    tabpanel.id = `tabpanel-${id}`;
    tabpanel.setAttribute('aria-hidden', !!i);
    tabpanel.setAttribute('aria-labelledby', `tab-${id}`);
    tabpanel.setAttribute('role', 'tabpanel');

    // build tab button
    const button = document.createElement('button');
    button.className = 'tabs-solutions-tab';
    button.id = `tab-${id}`;

    button.innerHTML = tab.innerHTML;

    button.setAttribute('aria-controls', `tabpanel-${id}`);
    button.setAttribute('aria-selected', !i);
    button.setAttribute('role', 'tab');
    button.setAttribute('type', 'button');
    button.addEventListener('click', () => {
      block.querySelectorAll('[role=tabpanel]').forEach((panel) => {
        panel.setAttribute('aria-hidden', true);
      });
      tablist.querySelectorAll('button').forEach((btn) => {
        btn.setAttribute('aria-selected', false);
      });
      tabpanel.setAttribute('aria-hidden', false);
      button.setAttribute('aria-selected', true);
    });
    tablist.append(button);
    tab.remove();

    // Group any sub-teasers (each starts with an <h3>) into a 2-column grid.
    // In the panel, sub-teasers are flat siblings: h3, p, p, h3, p, p ...
    const content = tabpanel.querySelector(':scope > div');
    if (content) {
      const headings = [...content.querySelectorAll(':scope > h3')];
      if (headings.length) {
        const grid = document.createElement('div');
        grid.className = 'tabs-solutions-subteasers';
        headings.forEach((h3) => {
          const teaser = document.createElement('div');
          teaser.className = 'tabs-solutions-subteaser';
          let node = h3;
          const group = [];
          // collect this heading and following siblings until the next h3
          while (node && !(node !== h3 && node.tagName === 'H3')) {
            group.push(node);
            node = node.nextElementSibling;
          }
          group.forEach((el) => teaser.append(el));
          grid.append(teaser);
        });
        content.append(grid);
      }
    }
  });

  block.prepend(tablist);
}
