import { el, button } from '../ui/dom';

/** 宿主DOM契约集中在此处；仅挂载自有入口，不修改宿主菜单和其他扩展。 */
export function mountEntryPoints(open: () => void): () => void {
  const target =
    document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
  const settings = el('details', 'sg-settings inline-drawer');
  settings.id = 'story-guide-settings';
  const summary = el('summary', 'sg-settings-summary inline-drawer-toggle inline-drawer-header');
  const icon = el('span', 'fa-solid fa-circle-chevron-down inline-drawer-icon down');
  icon.setAttribute('aria-hidden', 'true');
  summary.append(el('b', '', '剧情指南'), icon);
  // 由原生details处理鼠标和键盘；阻止宿主委托处理同一次点击。
  summary.addEventListener('click', (event) => event.stopPropagation());
  settings.addEventListener('toggle', () => {
    icon.classList.toggle('fa-circle-chevron-up', settings.open);
    icon.classList.toggle('fa-circle-chevron-down', !settings.open);
    icon.classList.toggle('up', settings.open);
    icon.classList.toggle('down', !settings.open);
  });
  const content = el('div', 'sg-settings-content');
  content.append(el('p', '', '读懂角色的故事，探索自己的路线。'), button('打开剧情指南', open, 'sg-primary'));
  settings.append(summary, content);
  if (target) target.append(settings);
  else console.warn('[剧情指南] 未找到扩展设置区域，可通过聊天扩展菜单打开');

  const container = el('div', 'extension_container');
  container.id = 'story-guide-menu-container';
  const item = button(
    '',
    () => {
      // 宿主会收起魔杖菜单；让面板关闭时焦点回到仍可见的菜单开关。
      const trigger = document.querySelector('#extensionsMenuButton');
      if (trigger instanceof HTMLElement) trigger.focus();
      open();
    },
    'sg-menu-entry list-group-item flex-container flexGap5',
  );
  item.id = 'story-guide-menu-entry';
  const menuIcon = el('span', 'fa-solid fa-book-open extensionsMenuExtensionButton');
  menuIcon.setAttribute('aria-hidden', 'true');
  item.append(menuIcon, el('span', '', '剧情指南'));
  container.append(item);
  const attachMenu = () => {
    const menu = document.querySelector('#extensionsMenu');
    if (!menu) return false;
    menu.append(container);
    return true;
  };
  let observer: MutationObserver | undefined;
  if (!attachMenu()) {
    observer = new MutationObserver(() => {
      if (attachMenu()) observer?.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  return () => {
    observer?.disconnect();
    settings.remove();
    container.remove();
  };
}
