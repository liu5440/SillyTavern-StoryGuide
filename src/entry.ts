import { GuideController } from './application/controller';
import { GuidePanel } from './ui/panel';
import { mountEntryPoints } from './host/entry-points';

function initialize() {
  window.storyGuideCleanup?.();
  const panel = new GuidePanel(new GuideController());
  const removeEntries = mountEntryPoints(() => panel.open());
  window.storyGuideCleanup = () => {
    panel.destroy();
    removeEntries();
    delete window.storyGuideCleanup;
  };
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
