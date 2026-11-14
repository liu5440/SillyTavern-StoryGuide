import type { ContextSnapshot } from '../host/tavern';
import type { Repository } from '../storage/repository';
import {
  decodeChatMaterials,
  planChatBatches,
  type ChatCapture,
  type ChatMessage,
} from '../domain/chat-materials';
import { chatArchiveSchema, type ChatArchive } from '../domain/chat-archive';
import { materialSchema, type Material } from '../domain/materials';
import { chatMaterialPrompt } from '../ai/material-prompts';
import { requestModel } from './model-request';

interface ChatHost {
  modelConnection?(): string;
  isCurrent(snapshot: ContextSnapshot): boolean;
  transcript(): string;
  chatLength(snapshot: ContextSnapshot): number;
  readChat(snapshot: ContextSnapshot, start: number, end: number): ChatMessage[];
  generate(prompt: string, signal: AbortSignal): Promise<string>;
}
export interface ChatMaterialDraft {
  capture: ChatCapture;
  cards: Material[];
  completedBatches: number;
  totalBatches: number;
  error?: string;
  notes?: string[];
}
export class ChatMaterialsController {
  private busy = false;
  constructor(
    private host: ChatHost,
    private repository: Repository,
    private snapshot: ContextSnapshot,
  ) {}
  guard(capture?: ChatCapture) {
    if (!this.host.isCurrent(this.snapshot)) throw new Error('角色或聊天已切换，请重新预览');
    if (
      capture &&
      (capture.chatKey !== this.snapshot.chatKey || capture.transcript !== this.host.transcript())
    )
      throw new Error('聊天内容已变化或修改，请重新预览，旧草稿不可保存');
  }
  info() {
    this.guard();
    return {
      total: this.host.chatLength(this.snapshot),
      api: this.host.modelConnection?.() ?? this.snapshot.api,
    };
  }
  read(start: number, end: number): ChatCapture {
    this.guard();
    if (!this.snapshot.chatKey) throw new Error('当前聊天没有有效标识，请先建立聊天');
    const messages = this.host.readChat(this.snapshot, start, end);
    return { chatKey: this.snapshot.chatKey, transcript: this.host.transcript(), messages };
  }
  async generate(
    capture: ChatCapture,
    numbers: number[],
    signal: AbortSignal,
    progress: (text: string) => void = () => {},
  ): Promise<ChatMaterialDraft> {
    this.guard(capture);
    if (signal.aborted) throw new Error('已取消整理');
    if (this.busy) throw new Error('正在整理，请等待或取消当前请求');
    const messages = capture.messages.filter((m) => numbers.includes(m.number));
    if (!messages.length || new Set(numbers).size !== numbers.length || messages.length !== numbers.length)
      throw new Error('请选择有效的消息，不能选择空范围');
    const batches = planChatBatches(messages);
    this.busy = true;
    try {
      const selected = { ...capture, messages };
      const result: ChatMaterialDraft = {
        capture: selected,
        cards: [],
        completedBatches: 0,
        totalBatches: batches.length,
      };
      for (const [index, batch] of batches.entries()) {
        this.guard(selected);
        if (signal.aborted) throw new Error('已取消整理，结果未保存');
        try {
          const raw = await requestModel(
            this.host,
            chatMaterialPrompt(batch),
            signal,
            `正在整理第${index + 1}/${batches.length}批 · 已完成${result.completedBatches}批 · 已得到${result.cards.length}条草稿`,
            progress,
          );
          if (signal.aborted) throw new Error('已取消整理，结果未保存');
          this.guard(selected);
          const cards = decodeChatMaterials(raw, { ...selected, messages: batch }, messages, (reason) =>
            (result.notes ??= []).push(`第${index + 1}批：${reason}`),
          );
          if (result.cards.length + cards.length > 200)
            throw new Error('本次结果超过200条，请先保存或导出已完成部分');
          result.cards.push(...cards);
          result.completedBatches++;
        } catch (error) {
          if (signal.aborted) throw new Error('已取消整理，结果未保存');
          this.guard(selected);
          if (!result.completedBatches) throw error;
          result.error = error instanceof Error ? error.message : '本批失败';
          return result;
        }
      }
      return result;
    } finally {
      this.busy = false;
    }
  }
  async save(draft: ChatMaterialDraft, cards: Material[], signal?: AbortSignal) {
    const check = () => {
      this.guard(draft.capture);
      if (signal?.aborted) throw new Error('已取消或关闭窗口，素材未保存');
    };
    check();
    this.guard(draft.capture);
    if (!cards.length || cards.length > 200) throw new Error('请选择1–200条素材');
    const validated = cards.map((card) => {
      const valid = materialSchema.safeParse(card);
      if (!valid.success)
        throw new Error(
          '素材信息无效：请检查标题、分类、描述和开场，标题最多100字符，描述与开场各最多2000字符',
        );
      return valid.data;
    });
    for (const card of validated) {
      const original = draft.cards.find((item) => item.id === card.id);
      if (
        !original ||
        card.method !== 'ai' ||
        card.quote !== original.quote ||
        JSON.stringify(card.source) !== JSON.stringify(original.source) ||
        JSON.stringify(card.evidence) !== JSON.stringify(original.evidence)
      )
        throw new Error('草稿来源发生变化，请重新整理');
    }
    await this.repository.saveMaterials(
      this.snapshot.user,
      this.snapshot.characterKey,
      validated,
      check,
      signal,
    );
    this.guard(draft.capture);
  }
  archive(
    capture: ChatCapture,
    numbers: number[],
    draft?: ChatMaterialDraft,
    cards: Material[] = draft?.cards ?? [],
    metadata: Pick<ChatArchive, 'title' | 'tags'> = {},
  ): ChatArchive {
    this.guard(capture);
    const messages = capture.messages.filter((m) => numbers.includes(m.number));
    if (messages.length !== new Set(numbers).size) throw new Error('所选消息无效');
    if (
      draft &&
      (draft.capture.transcript !== capture.transcript ||
        JSON.stringify(draft.capture.messages) !== JSON.stringify(messages))
    )
      throw new Error('草稿与所选消息不一致，请重新整理');
    for (const card of cards) {
      const original = draft?.cards.find((m) => m.id === card.id);
      if (
        !original ||
        JSON.stringify(card.source) !== JSON.stringify(original.source) ||
        card.quote !== original.quote ||
        JSON.stringify(card.evidence) !== JSON.stringify(original.evidence)
      )
        throw new Error('归档引用发生变化');
    }
    return chatArchiveSchema.parse({
      format: 'story-guide-chat-archive',
      schemaVersion: 1,
      id: crypto.randomUUID(),
      characterKey: this.snapshot.characterKey,
      characterName: this.snapshot.characterName,
      chatKey: capture.chatKey,
      transcript: capture.transcript,
      createdAt: new Date().toISOString(),
      ...metadata,
      status: draft ? (draft.error ? 'partial' : 'complete') : 'raw',
      completedBatches: draft?.completedBatches ?? 0,
      totalBatches: draft?.totalBatches ?? 0,
      ...(draft?.error ? { error: draft.error } : {}),
      messages: messages.map(({ number, role, speaker, text }) => ({ number, role, speaker, text })),
      materials: cards,
    });
  }
  async saveArchive(archive: ChatArchive, signal?: AbortSignal, finalizeRaw = false) {
    const check = () => {
      this.guard({ chatKey: archive.chatKey, transcript: archive.transcript, messages: archive.messages });
      if (archive.characterKey !== this.snapshot.characterKey || signal?.aborted)
        throw new Error('角色或归档已失效');
    };
    check();
    if (finalizeRaw) await this.repository.finalizeChatArchive(this.snapshot.user, archive, check, signal);
    else await this.repository.saveChatArchive(this.snapshot.user, archive, check, signal);
    check();
  }
}
