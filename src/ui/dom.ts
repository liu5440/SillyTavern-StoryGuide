export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}
export function button(text: string, handler: () => void | Promise<void>, className = ''): HTMLButtonElement {
  const node = el('button', `sg-button ${className}`, text);
  node.type = 'button';
  node.addEventListener('click', () => {
    void handler();
  });
  return node;
}
export function field(
  label: string,
  value: string,
  multiline = false,
): { root: HTMLLabelElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const root = el('label', 'sg-field');
  root.append(el('span', '', label));
  const input = multiline ? el('textarea') : el('input');
  input.value = value;
  root.append(input);
  return { root, input };
}
export function check(label: string, value: boolean, handler?: (value: boolean) => void) {
  const root = el('label', 'sg-check');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = value;
  root.append(input, document.createTextNode(label));
  input.addEventListener('change', () => handler?.(input.checked));
  return { root, input };
}
export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = el('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function showModal(title: string, build: (body: HTMLElement, close: () => void) => void) {
  const previous = document.activeElement;
  const dialog = el('dialog', 'sg-modal');
  const header = el('header', 'sg-modal-head');
  const close = () => dialog.close();
  header.append(el('h2', '', title), button('关闭', close));
  const body = el('div', 'sg-modal-body');
  build(body, close);
  dialog.append(header, body);
  document.body.append(dialog);
  dialog.addEventListener(
    'close',
    () => {
      dialog.remove();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    },
    { once: true },
  );
  dialog.showModal();
}
