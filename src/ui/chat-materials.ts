import type { MaterialsController } from '../application/materials';
import type { ChatMaterialDraft } from '../application/chat-materials';
import { planChatBatches, type ChatCapture } from '../domain/chat-materials';
import { chatArchiveFileName, type ChatArchive } from '../domain/chat-archive';
import { materialCategories, type Material } from '../domain/materials';
import { el, button, check, field, showModal, download } from './dom';
import { openDiagnostics } from './diagnostics';
import { diagnosticReport } from '../diagnostics';

/** UI只收集范围与审阅结果，读取、模型调用和写入均由应用层负责。 */
export function openChatMaterials(materials: MaterialsController, saved: () => Promise<void>) {
  const app = materials.chatController();
  showModal('从当前聊天整理', (body, close) => {
    body.classList.add('sg-chat-materials');
    const status = el('p', 'sg-chat-material-status', '选择范围后先预览，确认内容再调用模型。');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const start = field('起始消息序号', '1'),
      end = field('结束消息序号', '1');
    for (const input of [start.input, end.input]) {
      if (input instanceof HTMLInputElement) {
        input.type = 'number';
        input.min = '1';
        input.step = '1';
      }
    }
    const info = el('p', 'sg-muted');
    const title = field('片段标题', '');
    title.input.placeholder = '例如：雨夜重逢、钟楼调查';
    const tags = field('片段标签', '');
    tags.input.placeholder = '用逗号分隔，例如：艾琳，钟楼，重逢';
    let savedRawKey = '';
    let savedRaw: ChatArchive | undefined;
    const archiveKey = (archive: ChatArchive) =>
      JSON.stringify([archive.transcript, archive.messages, archive.title, archive.tags]);
    const scope = el('select');
    scope.setAttribute('aria-label', '整理消息来源');
    for (const [value, label] of [
      ['assistant', '仅 AI 回复（默认）'],
      ['all', '全部对话（含玩家发言）'],
    ] as const) {
      const option = el('option', '', label);
      option.value = value;
      scope.append(option);
    }
    const scopeLabel = el('label', 'sg-field');
    scopeLabel.append(el('span', '', '整理消息来源'), scope);
    const sourceList = el('div', 'sg-chat-message-list');
    const results = el('div', 'sg-chat-draft-list');
    const summary = el('p', 'sg-chat-selection');
    let capture: ChatCapture | undefined, draft: ChatMaterialDraft | undefined;
    let selected = new Set<number>();
    let abort: AbortController | undefined;
    let previewCount = 0;
    let busy = false,
      unsubscribe = () => {};
    let edits: {
      card: Material;
      keep: HTMLInputElement;
      title: HTMLInputElement | HTMLTextAreaElement;
      description: HTMLInputElement | HTMLTextAreaElement;
      opening: HTMLInputElement | HTMLTextAreaElement;
      category: HTMLSelectElement;
    }[] = [];
    const setBusy = (value: boolean) => {
      busy = value;
      body
        .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')
        .forEach((input) => {
          input.disabled = value;
        });
      updateSummary();
    };
    const message = (text: string, error = false) => {
      status.textContent = text;
      status.classList.toggle('sg-error', error);
    };
    const guard = () => {
      app.guard();
      if (!body.isConnected) throw new Error('整理窗口已关闭，旧操作已丢弃');
    };
    const resetResults = () => {
      draft = undefined;
      edits = [];
      results.replaceChildren();
    };
    const invalidate = () => {
      abort?.abort();
      capture = undefined;
      selected.clear();
      resetResults();
      generate.disabled = true;
      updateSummary();
      message('聊天内容已变化，请重新预览；旧结果不可保存。', true);
    };
    const selectedSize = () => {
      const messages = capture?.messages.filter((m) => selected.has(m.number)) ?? [];
      return { count: messages.length, size: messages.reduce((n, m) => n + m.text.length, 0) };
    };
    const updateSummary = () => {
      const { count, size } = selectedSize();
      const messages = capture?.messages.filter((m) => selected.has(m.number)) ?? [];
      const batches = count > 0 && count <= 50 ? planChatBatches(messages).length : 0;
      summary.textContent = `选中${count}条 · ${size}字符。原文可直接保存或导出，无需AI（最多100条）。${batches ? `可选AI整理自动分${batches}批，预计${batches}次请求，每批12000字符；原文会先保存。` : count > 50 ? 'AI整理每次最多50条；不影响原文归档。' : '请勾选消息。'}`;
      generate.disabled = busy || !batches;
      generate.title = busy
        ? '正在等待酒馆模型返回，可取消整理或查看排查日志'
        : !batches
          ? '请预览范围并勾选1–50条有效消息'
          : '将选中消息交给酒馆当前模型整理';
      exportChat.disabled = busy || !count || count > 100;
      saveArchive.disabled = busy || !count || count > 100;
    };
    const preview = button('预览当前范围', () => {
      try {
        guard();
        if (busy) throw new Error('请先取消或等待当前整理结束');
        const next = app.read(Number(start.input.value), Number(end.input.value));
        capture = next;
        const visible = next.messages.filter((m) => scope.value === 'all' || m.role === 'character');
        selected = new Set(visible.map((m) => m.number));
        resetResults();
        sourceList.replaceChildren();
        for (const m of visible) {
          const row = el('section', 'sg-chat-message');
          const include = check(
            `选择第${m.number}条 · ${m.role === 'user' ? '玩家' : 'AI回复'}`,
            true,
            (yes) => {
              if (yes) selected.add(m.number);
              else selected.delete(m.number);
              resetResults();
              updateSummary();
            },
          );
          const text = el('details');
          text.append(
            el('summary', '', `第${m.number}条 · ${m.speaker} · ${m.text.length}字符（展开全文）`),
            el('pre', 'sg-material-source', m.text),
          );
          row.append(include.root, text);
          sourceList.append(row);
        }
        sourceList.scrollTop = 0;
        previewCount++;
        updateSummary();
        message(
          visible.length
            ? `已刷新第${previewCount}次预览：第${start.input.value}–${end.input.value}条，载入${visible.length}条${scope.value === 'all' ? '对话消息' : 'AI回复'}。${scope.value === 'all' ? '' : '玩家发言不参与整理和导出。'}系统和空消息已排除。`
            : `此范围没有可整理的${scope.value === 'all' ? '消息' : 'AI回复'}，请调整范围。`,
        );
      } catch (error) {
        capture = undefined;
        selected.clear();
        sourceList.replaceChildren();
        resetResults();
        updateSummary();
        message(error instanceof Error ? error.message : '读取聊天失败', true);
      }
    });
    const cancel = button('取消整理', () => {
      abort?.abort();
      resetResults();
      message('已取消整理；底层模型请求可能继续执行和计费，旧结果不会保存。');
    });
    const generate = button(
      '用当前模型整理',
      async () => {
        if (busy) return;
        let rawReady = false;
        try {
          guard();
          if (!capture) throw new Error('请先预览当前范围');
          app.guard(capture);
          resetResults();
          setBusy(true);
          generate.disabled = true;
          preview.disabled = true;
          abort = new AbortController();
          await ensureRawSaved(abort.signal);
          guard();
          rawReady = true;
          const { count, size } = selectedSize();
          message(`正在使用酒馆当前${app.info().api}连接整理${count}条、${size}字符…（每批最多180秒）`);
          const next = await app.generate(capture, [...selected], abort.signal, (text) => message(text));
          guard();
          draft = next;
          if (!next.cards.length) {
            message(
              next.error
                ? `部分完成：${next.completedBatches}/${next.totalBatches}批。${next.error}。可保存或导出原文归档。`
                : '模型未生成AI素材；原文已保存到聊天剧情归档，可直接导出。',
              !!next.error,
            );
            return;
          }
          for (const [index, card] of next.cards.entries()) {
            const row = el('section', 'sg-chat-draft');
            const keep = check(`保存素材${index + 1}`, true);
            const title = field(`草稿标题${index + 1}`, card.title);
            const description = field(`AI归纳描述${index + 1}`, card.description, true);
            const opening = field(`原创开场${index + 1}`, card.opening, true);
            const category = el('select');
            category.setAttribute('aria-label', `草稿分类${index + 1}`);
            for (const [key, label] of Object.entries(materialCategories)) {
              const option = el('option', '', label);
              option.value = key;
              category.append(option);
            }
            category.value = card.category;
            row.append(
              keep.root,
              el('p', 'sg-badge', 'AI归纳 / 原创开场 · 需玩家审阅，并非原文事实'),
              title.root,
              category,
              description.root,
              opening.root,
              el('small', 'sg-muted', card.source?.label ?? ''),
              el('blockquote', '', card.quote),
            );
            edits.push({
              card,
              keep: keep.input,
              title: title.input,
              description: description.input,
              opening: opening.input,
              category,
            });
            results.append(row);
          }
          const save = button(
            '保存选中素材',
            async () => {
              if (busy) return;
              try {
                guard();
                if (!draft) throw new Error('草稿已失效，请重新整理');
                setBusy(true);
                cancel.disabled = true;
                save.disabled = true;
                preview.disabled = true;
                generate.disabled = true;
                const cards = edits
                  .filter((edit) => edit.keep.checked)
                  .map((edit) => ({
                    ...edit.card,
                    title: edit.title.value,
                    description: edit.description.value,
                    opening: edit.opening.value,
                    category: edit.category.value as Material['category'],
                  }));
                await app.save(draft, cards, abort?.signal);
                await saved();
                close();
              } catch (error) {
                message(error instanceof Error ? error.message : '保存失败，草稿仍保留', true);
              } finally {
                setBusy(false);
                cancel.disabled = false;
                save.disabled = false;
                preview.disabled = false;
                updateSummary();
              }
            },
            'sg-primary',
          );
          results.append(save);
          message(
            `${next.error ? `部分完成：${next.completedBatches}/${next.totalBatches}批，${next.error}。` : `已完成${next.totalBatches}批。`}已生成${next.cards.length}条草稿，尚未保存。可保存素材或另存聊天归档。`,
            !!next.error,
          );
        } catch (error) {
          message(
            `${error instanceof Error ? error.message : 'AI整理失败'}${rawReady ? '。原文已先保存到聊天剧情归档，可直接导出或稍后处理。' : ''}`,
            true,
          );
        } finally {
          setBusy(false);
          updateSummary();
          preview.disabled = false;
        }
      },
      '',
    );
    generate.disabled = true;
    const getArchive = (includeAI = true) => {
      guard();
      if (!capture) throw new Error('请先预览并选择消息');
      const cards = draft
        ? edits
            .filter((edit) => edit.keep.checked)
            .map((edit) => ({
              ...edit.card,
              title: edit.title.value,
              description: edit.description.value,
              opening: edit.opening.value,
              category: edit.category.value as Material['category'],
            }))
        : [];
      const labels = [
        ...new Set(
          tags.input.value
            .split(/[,，、]/u)
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      ];
      if (labels.length > 12 || labels.some((tag) => tag.length > 30))
        throw new Error('最多12个标签，每个不超过30字');
      if (title.input.value.trim().length > 160) throw new Error('片段标题最多160字');
      const archive = app.archive(
        capture,
        [...selected],
        includeAI ? draft : undefined,
        includeAI ? cards : [],
        {
          title: title.input.value.trim() || `第${[...selected][0] ?? 1}条起的故事片段`,
          tags: labels,
        },
      );
      return savedRaw && savedRawKey === archiveKey(archive)
        ? { ...archive, id: savedRaw.id, createdAt: savedRaw.createdAt }
        : archive;
    };
    const ensureRawSaved = async (signal?: AbortSignal) => {
      const archive = getArchive(false);
      const key = archiveKey(archive);
      if (savedRawKey === key) return archive;
      await app.saveArchive(archive, signal);
      guard();
      signal?.throwIfAborted();
      savedRawKey = key;
      savedRaw = archive;
      return archive;
    };
    const exportChat = button('导出所选聊天JSON', () => {
      try {
        if (busy) throw new Error('请先等待或取消当前任务');
        const archive = getArchive();
        download(chatArchiveFileName(archive), archive);
        message(`已导出${archive.messages.length}条完整消息及${archive.materials.length}条整理结果`);
      } catch (error) {
        message(error instanceof Error ? error.message : '导出失败', true);
      }
    });
    const saveArchive = button('保存聊天归档', async () => {
      if (busy) return;
      try {
        const archive = getArchive();
        setBusy(true);
        generate.disabled = true;
        preview.disabled = true;
        cancel.disabled = true;
        abort = new AbortController();
        if (draft) {
          const upgrade = !!savedRaw && savedRawKey === archiveKey(archive);
          await app.saveArchive(archive, abort.signal, upgrade);
          savedRaw = undefined;
          savedRawKey = '';
        } else await ensureRawSaved(abort.signal);
        guard();
        message(
          `已保存${archive.messages.length}条消息的${archive.status === 'partial' ? '部分整理' : ''}归档，可在素材库“聊天剧情归档”中再次导出。`,
        );
      } catch (error) {
        message(error instanceof Error ? error.message : '归档保存失败', true);
      } finally {
        setBusy(false);
        preview.disabled = false;
        cancel.disabled = false;
        updateSummary();
      }
    });
    exportChat.disabled = true;
    saveArchive.disabled = true;
    for (const input of [start.input, end.input])
      input.addEventListener('input', () => {
        invalidate();
        sourceList.replaceChildren();
        summary.textContent = '';
        exportChat.disabled = true;
        saveArchive.disabled = true;
        message('消息范围已调整，请重新预览。');
      });
    const range = el('div', 'sg-material-controls sg-chat-range');
    scope.addEventListener('change', () => {
      if (!busy) preview.click();
    });
    range.append(start.root, end.root, preview);
    const actions = el('div', 'sg-toolbar');
    saveArchive.classList.add('sg-primary');
    actions.append(saveArchive, exportChat);
    const ai = el('details', 'sg-details');
    ai.open = true;
    ai.append(el('summary', '', '可选：用酒馆AI整理'), generate, cancel, button('排查日志', openDiagnostics));
    body.append(
      el(
        'p',
        'sg-muted',
        '先把选中的聊天当作故事片段保存：保留完整原文及角色、聊天、消息序号，不调用AI。JSON可交给其他工具继续整理。可选AI整理会发送所选内容至酒馆当前模型，仅归纳适合的非露骨素材；模型失败不影响已保存原文。不会改写或发送聊天。',
      ),
      info,
      scopeLabel,
      range,
      title.root,
      tags.root,
      sourceList,
      summary,
      actions,
      status,
      ai,
      results,
    );
    // showModal在构建后挂载，等挂载完成再接入生命周期。
    queueMicrotask(() => {
      if (!body.isConnected) return;
      body.closest('dialog')?.addEventListener(
        'close',
        () => {
          abort?.abort();
          unsubscribe();
        },
        { once: true },
      );
      unsubscribe = materials.watchChat(invalidate);
      try {
        const current = app.info();
        info.textContent = `当前共有${current.total}条消息 · 模型连接：${current.api} · 扩展版本：${diagnosticReport().version}`;
        start.input.value = String(Math.max(1, current.total - 49));
        end.input.value = String(Math.max(1, current.total));
        if (!current.total) {
          preview.disabled = true;
          message('当前聊天为空，请先进行聊天。');
        } else {
          preview.click();
        }
      } catch (error) {
        preview.disabled = true;
        message(error instanceof Error ? error.message : '无法读取聊天', true);
      }
    });
  });
}
