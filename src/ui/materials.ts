import { MaterialsController } from '../application/materials';
import {
  extractMaterial,
  filterMaterials,
  materialCategories,
  materialText,
  type Material,
  type MaterialCategory,
} from '../domain/materials';
import { el, button, check, field, showModal, download } from './dom';

/** 仅展示与收集用户选区；不读取聊天 DOM、不请求模型、不向聊天写入内容。 */
export function openMaterials(app: MaterialsController) {
  showModal('场景素材库', (body) => {
    body.classList.add('sg-material-library');
    const status = el('p', 'sg-material-status', '正在读取素材…');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const list = el('div', 'sg-material-grid');
    let cards: Material[] = [],
      favorites = new Set<string>();
    let pending = false;
    const message = (text: string, error = false) => {
      status.textContent = text;
      status.classList.toggle('sg-error', error);
    };
    const guard = () => {
      app.guard();
      if (!body.isConnected) throw new Error('素材库已关闭，请重新打开');
    };
    const safe = async (action: () => Promise<void>) => {
      if (pending) {
        message('正在处理，请等待完成');
        return;
      }
      pending = true;
      try {
        guard();
        await action();
      } catch (error) {
        message(error instanceof Error ? error.message : '素材操作失败，请重试', true);
      } finally {
        pending = false;
      }
    };
    const category = categorySelect('素材分类', true);
    const search = field('搜索素材', '');
    search.input.placeholder = '标题、氛围、描述或开场';
    const onlyFavorites = check('只看收藏', false, () => render());
    const onlyPersonal = check('只看个人素材', false, () => render());
    const reload = async () => {
      const data = await app.load();
      guard();
      cards = data.cards;
      favorites = new Set(data.favorites);
      render();
    };
    function render() {
      const filtered = filterMaterials(
        cards,
        category.value as MaterialCategory | 'all',
        search.input.value,
      ).filter(
        (card) =>
          (!onlyFavorites.input.checked || favorites.has(card.id)) &&
          (!onlyPersonal.input.checked || card.origin === 'dialogue'),
      );
      list.replaceChildren();
      for (const card of filtered) {
        const article = el('article', 'sg-material-card');
        article.append(
          el(
            'span',
            'sg-badge',
            `${materialCategories[card.category]} · ${card.origin === 'builtin' ? '内置原创' : '对话摘录 / 用户改编'}`,
          ),
          el('h3', '', card.title),
          el('small', 'sg-muted', card.tags.join(' · ')),
          el('p', '', card.description),
          el('p', 'sg-material-opening', card.opening),
        );
        const actions = el('div', 'sg-toolbar');
        actions.append(
          button('复制素材', () =>
            safe(async () => {
              await navigator.clipboard.writeText(materialText(card));
              guard();
              message('素材已复制，没有发送聊天');
            }),
          ),
          button(favorites.has(card.id) ? '取消收藏' : '收藏', () =>
            safe(async () => {
              await app.favorite(card.id, !favorites.has(card.id));
              await reload();
              message('收藏已保存到当前浏览器');
            }),
          ),
        );
        if (card.source)
          actions.append(
            button('查看来源', () => {
              showModal('素材来源', (sourceBody) => {
                const source = card.source;
                if (!source) return;
                sourceBody.append(
                  el('h3', '', source.label),
                  el(
                    'p',
                    'sg-muted',
                    `原文字符 ${source.start + 1}–${source.end}；以下仅为摘录，不代表角色原设定。`,
                  ),
                  el('blockquote', '', card.quote),
                );
                const details = el('details');
                details.append(
                  el('summary', '', '查看保存的完整对话'),
                  el('pre', 'sg-material-source', source.text),
                );
                sourceBody.append(details);
              });
            }),
            button('删除个人素材', () => {
              showModal('删除个人素材', (confirmBody, close) => {
                confirmBody.append(
                  el('p', '', `删除「${card.title}」及其收藏。可先导出素材备份留存。`),
                  button('确认删除', () =>
                    safe(async () => {
                      await app.remove(card.id);
                      await reload();
                      close();
                      message('个人素材已删除');
                    }),
                  ),
                );
              });
            }),
          );
        article.append(actions);
        list.append(article);
      }
      if (!filtered.length)
        list.append(el('p', 'sg-empty', '没有匹配的素材。可以清空筛选，或整理自己的对话片段。'));
    }
    category.addEventListener('change', render);
    search.input.addEventListener('input', render);
    const controls = el('div', 'sg-material-controls');
    controls.append(search.root, category, onlyFavorites.root, onlyPersonal.root);
    const tools = el('div', 'sg-toolbar');
    tools.append(
      button('整理粘贴的对话', () =>
        openExtractor(app, async () => {
          await reload();
          message('个人素材已保存到当前浏览器');
        }),
      ),
      button('导出素材备份', () =>
        safe(async () => {
          const data = await app.backup();
          guard();
          download('story-guide-materials.json', data);
          message('素材备份已导出（包含个人摘录与收藏）');
        }),
      ),
    );
    body.append(
      el(
        'p',
        'sg-muted',
        '成年角色的非露骨恋爱创作素材。选择后复制使用；内置原创并非角色原设定。个人素材按账号、角色保存在当前浏览器，可导出留存。',
      ),
      tools,
      controls,
      status,
      list,
    );
    // showModal 在 build 返回后才挂载；等本次构建完成再检查弹窗生命周期。
    queueMicrotask(() => {
      void safe(async () => {
        await reload();
        message('选择分类或搜索关键词，找到合适的故事开场。');
      });
    });
  });
}

function categorySelect(label: string, all = false) {
  const select = el('select');
  select.setAttribute('aria-label', label);
  for (const [value, text] of [
    ...(all ? [['all', '全部分类']] : []),
    ...Object.entries(materialCategories),
  ]) {
    const option = el('option', '', text);
    option.value = value ?? '';
    select.append(option);
  }
  return select;
}

function openExtractor(app: MaterialsController, saved: () => Promise<void>) {
  showModal('整理对话片段', (body, closeEditor) => {
    const label = field('对话来源名称', '手动粘贴的对话');
    const raw = field('对话原文', '', true);
    const title = field('素材标题', '');
    title.input.maxLength = 100;
    const category = categorySelect('整理素材分类');
    const tags = field('氛围标签（顿号分隔）', '');
    const description = field('素材描述（用户改编）', '', true);
    description.input.maxLength = 2000;
    const opening = field('剧情开场（用户改编）', '', true);
    opening.input.maxLength = 2000;
    const status = el('p');
    status.setAttribute('role', 'status');
    const quote = el('blockquote', '', '粘贴对话后，用鼠标或键盘选中需要的片段。');
    let selection: { text: string; start: number; end: number } | undefined;
    let saving = false;
    function report(error: unknown) {
      status.textContent = error instanceof Error ? error.message : '整理失败，请重试';
      status.className = 'sg-error';
    }
    body.append(
      el(
        'p',
        'sg-muted',
        '仅整理成年角色的非露骨服装、姿态、互动和场景。原文最多 20000 字符，选区最多 2000 字符；会保存完整粘贴原文以核对来源，请只粘贴愿意留存的内容。不会向模型发送对话。',
      ),
      label.root,
      raw.root,
      button('使用选中片段', () => {
        if (raw.input.value.length > 20000) {
          report(new Error('原文超过20000字符，请缩小粘贴范围；没有截断或保存'));
          return;
        }
        const start = raw.input.selectionStart ?? 0,
          end = raw.input.selectionEnd ?? 0;
        if (end <= start || end - start > 2000) {
          report(new Error('请选择 1–2000 字符的对话片段'));
          return;
        }
        selection = { text: raw.input.value, start, end };
        quote.textContent = selection.text.slice(start, end);
        status.textContent = '选区已记录，请补充素材信息并预览。';
        status.className = '';
      }),
      quote,
      title.root,
      category,
      tags.root,
      description.root,
      opening.root,
      status,
      button(
        '预览素材',
        () => {
          try {
            app.guard();
            if (!selection || raw.input.value !== selection.text)
              throw new Error('请先选中原文片段；原文修改后需要重新选择');
            const input = {
              id: `personal:${crypto.randomUUID()}`,
              title: title.input.value,
              category: category.value as MaterialCategory,
              tags: tags.input.value
                .split('、')
                .map((s) => s.trim())
                .filter(Boolean),
              description: description.input.value,
              opening: opening.input.value,
              source: { ...selection, label: label.input.value },
            };
            const card = extractMaterial(input);
            showModal('素材预览', (preview, closePreview) => {
              preview.classList.add('sg-material-preview');
              preview.append(
                el('pre', 'sg-material-source', materialText(card)),
                el('h3', '', `原文摘录 · ${input.source.label}`),
                el('blockquote', '', card.quote),
              );
              const result = el('p');
              result.setAttribute('role', 'status');
              const save = button(
                '保存到个人素材',
                async () => {
                  if (saving) return;
                  saving = true;
                  save.disabled = true;
                  try {
                    if (!body.isConnected || !preview.isConnected)
                      throw new Error('编辑器已关闭，请重新打开');
                    await app.save(input);
                    await saved();
                    closePreview();
                    closeEditor();
                  } catch (error) {
                    result.textContent = error instanceof Error ? error.message : '保存失败';
                    result.className = 'sg-error';
                  } finally {
                    saving = false;
                    save.disabled = false;
                  }
                },
                'sg-primary',
              );
              preview.append(result, save);
            });
          } catch (error) {
            report(error);
          }
        },
        'sg-primary',
      ),
    );
  });
}
