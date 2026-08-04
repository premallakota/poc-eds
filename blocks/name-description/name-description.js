export default function decorate(block) {
  const [nameRow, descriptionRow] = block.children;

  if (nameRow) nameRow.className = 'name-description-name';
  if (descriptionRow) descriptionRow.className = 'name-description-description';
}
