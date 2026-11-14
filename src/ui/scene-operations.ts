import type { MaterialsController } from '../application/materials';
import type { Material } from '../domain/materials';
import { field, el, button, check, showModal } from './dom';
import { sceneFields } from './scene-fields';

export function openSceneOperation(
  app: MaterialsController,
  sources: Material[],
  split: boolean,
  saved: () => Promise<void>,
) {
  showModal(split ? '拆分关键场景' : '合并关键场景', (body, close) => {
    body.append(
      el(
        'p',
        'sg-muted',
        `原场景全部保留；新场景保存完整原文证据与派生来源。仅手工整理已有内容，不调用模型，不改变路线或进度。原记录：${sources.map((card) => card.title).join('、')}`,
      ),
    );
    const first = sources[0];
    if (!first?.scene) return;
    const forms = Array.from({ length: split ? 2 : 1 }, (_, index) => {
      const title = field(
        `新场景${index + 1}名称`,
        split ? '' : sources.map((card) => card.title).join(' / '),
      );
      const description = field('剧情简介（人工整理）', '', true);
      const scene = sceneFields(first);
      const section = el('section');
      section.append(title.root, description.root, ...(scene ? [scene.root] : []));
      body.append(section);
      return { title, description, scene };
    });
    const feedback = el('p');
    let pending = false;
    const save = button('另存新场景并保留原记录', async () => {
      if (pending) return;
      pending = true;
      save.disabled = true;
      try {
        const guard = () => {
          app.guard();
          if (!body.isConnected) throw new Error('整理窗口已关闭');
        };
        guard();
        await app.derive(
          sources,
          forms.map((form) => ({
            title: form.title.input.value,
            description: form.description.input.value,
            scene: form.scene?.read(true),
          })),
          guard,
        );
        await saved();
        close();
      } catch (error) {
        feedback.textContent = error instanceof Error ? error.message : '保存失败';
      } finally {
        pending = false;
        save.disabled = false;
      }
    });
    body.append(feedback, save);
  });
}

export function openSceneMerge(app: MaterialsController, cards: Material[], saved: () => Promise<void>) {
  showModal('选择要合并的关键场景', (body, close) => {
    const entries = cards
      .filter((card) => card.origin === 'dialogue' && card.scene)
      .map((card) => ({ card, control: check(card.title, false) }));
    const feedback = el('p');
    body.append(
      ...entries.map((entry) => entry.control.root),
      feedback,
      button('编辑合并摘要', () => {
        const selected = entries.filter((entry) => entry.control.input.checked).map((entry) => entry.card);
        if (selected.length < 2) {
          feedback.textContent = '请至少选择两个已保存关键场景';
          return;
        }
        close();
        openSceneOperation(app, selected, false, saved);
      }),
    );
  });
}

export function openMaterialImport(app: MaterialsController, saved: () => Promise<void>) {
  showModal('导入素材备份', (body, close) => {
    const text = field('素材备份JSON', '', true);
    const file = el('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.setAttribute('aria-label', '选择素材备份文件');
    const feedback = el('p');
    let pending = false;
    file.addEventListener('change', () => {
      void (async () => {
        try {
          const selected = file.files?.[0];
          if (!selected) return;
          if (selected.size > 24_000_000) throw new Error('备份文件过大');
          text.input.value = await selected.text();
        } catch (error) {
          feedback.textContent = error instanceof Error ? error.message : '读取失败';
        }
      })();
    });
    body.append(
      el(
        'p',
        'sg-muted',
        '先校验再预览。仅导入当前角色素材备份；故事或聊天归档不适用。始终另存新ID，不覆盖已有条目；剧情关联不导入。',
      ),
      file,
      text.root,
      feedback,
      button('校验并预览', async () => {
        if (pending) return;
        pending = true;
        try {
          const preview = await app.previewBackup(text.input.value);
          if (!body.isConnected) throw new Error('导入窗口已关闭');
          showModal('素材导入预览', (review, closeReview) => {
            review.append(
              el(
                'p',
                '',
                `另存 ${preview.cards.length} 条；同ID冲突 ${preview.conflicts.length} 条，均保留原记录；映射收藏 ${preview.favorites.length} 条。`,
              ),
            );
            if (preview.legacyAccount)
              review.append(
                el('p', 'sg-error', '旧备份未记录账号，无法核实原账号；确认来源后才导入当前账号。'),
              );
            const details = el(
              'pre',
              'sg-material-source',
              preview.cards.map((card) => card.title).join('\n'),
            );
            const result = el('p');
            let saving = false;
            const save = button('确认另存到当前角色', async () => {
              if (saving) return;
              saving = true;
              save.disabled = true;
              try {
                await app.importBackup(preview, () => {
                  if (!body.isConnected || !review.isConnected) throw new Error('导入预览已关闭');
                });
                await saved();
                closeReview();
                close();
              } catch (error) {
                result.textContent = error instanceof Error ? error.message : '导入失败';
              } finally {
                saving = false;
                save.disabled = false;
              }
            });
            review.append(details, result, save);
          });
        } catch (error) {
          feedback.textContent = error instanceof Error ? error.message : '校验失败';
        } finally {
          pending = false;
        }
      }),
    );
  });
}
