import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * loads and decorates the footer
 * @param {Element} block The footer block element
 */
export default async function decorate(block) {
  const footerMeta = getMetadata('footer');
  const footerPath = footerMeta ? new URL(footerMeta, window.location).pathname : '/footer';
  const fragment = await loadFragment(footerPath);

  block.textContent = '';
  const footer = document.createElement('div');
  while (fragment.firstElementChild) footer.append(fragment.firstElementChild);

  // Classify sections: brand (logo/social) → columns (heading) → legal (text only)
  [...footer.children].forEach((section) => {
    if (section.querySelector('img')) {
      section.classList.add('footer-brand');
      const socialList = section.querySelector('ul');
      if (socialList) socialList.classList.add('footer-social');
    } else if (section.querySelector('h3')) {
      section.classList.add('footer-column');
    } else {
      section.classList.add('footer-legal');
    }
  });

  block.append(footer);
}
