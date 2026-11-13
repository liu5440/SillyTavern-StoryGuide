import type { ContextSnapshot } from '../host/tavern';
import type { Repository } from '../storage/repository';
import { decodeChatMaterials, type ChatCapture, type ChatMessage } from '../domain/chat-materials';
import { materialSchema, type Material } from '../domain/materials';
import { chatMaterialPrompt } from '../ai/material-prompts';

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
  async generate(capture: ChatCapture, numbers: number[], signal: AbortSignal): Promise<ChatMaterialDraft> {
    this.guard(capture);
    if (signal.aborted) throw new Error('已取消整理');
    if (this.busy) throw new Error('正在整理，请等待或取消当前请求');
    const messages = capture.messages.filter((m) => numbers.includes(m.number));
    if (!messages.length || new Set(numbers).size !== numbers.length || messages.length !== numbers.length)
      throw new Error('请选择有效的消息，不能选择空范围');
    if (messages.length > 50 || messages.reduce((n, m) => n + m.text.length, 0) > 12000)
      throw new Error('一次最多50条、12000字符，请取消部分勾选后重试；没有截断');
    this.busy = true;
    try {
      const selected = { ...capture, messages };
      const raw = await this.host.generate(chatMaterialPrompt(messages), signal);
      if (signal.aborted) throw new Error('已取消整理，结果未保存');
      this.guard(selected);
      return { capture: selected, cards: decodeChatMaterials(raw, selected) };
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
    if (!cards.length || cards.length > 8) throw new Error('请选择1–8条素材');
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
        JSON.stringify(card.source) !== JSON.stringify(original.source)
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
}
