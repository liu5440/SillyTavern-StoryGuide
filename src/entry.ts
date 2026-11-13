import { GuideController } from './application/controller';
import { GuidePanel } from './ui/panel';
import { el, button } from './ui/dom';

function initialize() {
  window.storyGuideCleanup?.();
  const target =
    document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
  if (!target) {
    console.warn('[剧情指南] 未找到酒馆扩展设置区域');
    return;
  }
  const panel = new GuidePanel(new GuideController());
  const settings = el('div', 'sg-settings');
  settings.id = 'story-guide-settings';
  settings.append(
    el('h3', '', '剧情指南'),
    el('p', '', '读懂角色的故事，探索自己的路线。'),
    button('打开剧情指南', () => panel.open(), 'sg-primary'),
  );
  target.append(settings);
  window.storyGuideCleanup = () => {
    panel.destroy();
    settings.remove();
    delete window.storyGuideCleanup;
  };
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
