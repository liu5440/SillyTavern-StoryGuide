import { z } from 'zod';
import { materialContentSchema, materialSchema, type Material } from './materials';

export interface ChatMessage {
  number: number;
  role: 'user' | 'character';
  speaker: string;
  text: string;
  offset?: number;
}
export interface ChatCapture {
  chatKey: string;
  transcript: string;
  messages: ChatMessage[];
}
const messageSchema = z
  .object({
    mes: z.string().max(20000),
    is_user: z.boolean().optional(),
    is_system: z.boolean().optional(),
    name: z.string().max(160).optional(),
  })
  .passthrough();

/** 使用原数组序号定位当前swipe；系统消息不作为模型素材，不截断消息。 */
export function selectChatMessages(raw: unknown, start: number, end: number): ChatMessage[] {
  if (!Array.isArray(raw)) throw new Error('当前酒馆未提供聊天记录');
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    end > raw.length ||
    end - start + 1 > 100
  )
    throw new Error('消息范围无效，每次预览最多100条');
  const messages: ChatMessage[] = [];
  let size = 0;
  for (let i = start - 1; i < end; i++) {
    const row: unknown = raw[i];
    if (row && typeof row === 'object' && 'is_system' in row && row.is_system === true) continue;
    const parsed = messageSchema.safeParse(row);
    if (!parsed.success) throw new Error(`第${i + 1}条消息结构无效或超过20000字符，请缩小范围`);
    if (!parsed.data.mes.trim()) continue;
    size += parsed.data.mes.length;
    if (size > 1000000) throw new Error('预览范围超过1000000字符，请缩小范围；没有截断');
    messages.push({
      number: i + 1,
      role: parsed.data.is_user ? 'user' : 'character',
      speaker: parsed.data.name || (parsed.data.is_user ? '玩家' : '角色'),
      text: parsed.data.mes,
    });
  }
  return messages;
}

/** 12000字符是单请求上限；完整消息按顺序分段，偏移仍指向原消息。 */
export function planChatBatches(messages: ChatMessage[]): ChatMessage[][] {
  if (!messages.length || messages.length > 50) throw new Error('请选择1–50条消息');
  const batches: ChatMessage[][] = [];
  let batch: ChatMessage[] = [],
    size = 0;
  for (const message of messages) {
    if (!message.text.length || message.text.length > 20000) throw new Error('单条消息需为1–20000字符');
    for (let offset = 0; offset < message.text.length; ) {
      let end = Math.min(offset + 12000, message.text.length);
      if (
        end < message.text.length &&
        /[\uD800-\uDBFF]/.test(message.text[end - 1] ?? '') &&
        /[\uDC00-\uDFFF]/.test(message.text[end] ?? '')
      )
        end--;
      const text = message.text.slice(offset, end);
      if (size + text.length > 12000) {
        batches.push(batch);
        batch = [];
        size = 0;
      }
      batch.push({ ...message, text, offset });
      size += text.length;
      offset = end;
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}

const resultSchema = z
  .object({
    materials: z
      .array(
        materialContentSchema
          .extend({ messageNumber: z.number().int().positive(), quote: z.string().min(1).max(2000) })
          .strict(),
      )
      .max(8),
  })
  .strict();
/** 模型只给消息序号与摘录；实际来源及偏移从已选快照构造，不能相信模型标签。 */
export function decodeChatMaterials(
  raw: string,
  capture: ChatCapture,
  originals: ChatMessage[] = capture.messages,
): Material[] {
  if (raw.length > 80000) throw new Error('模型返回超过80000字符，未采用');
  const text = raw.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('模型未返回有效JSON，未保存任何素材，请重试或缩小范围');
  }
  const result = resultSchema.safeParse(value);
  if (!result.success)
    throw new Error('模型素材结构无效，需包含materials数组、分类、描述、开场、消息序号和摘录（最多8条）');
  return result.data.materials.map((item) => {
    const message = capture.messages.find(
      (m) => m.number === item.messageNumber && m.text.includes(item.quote),
    );
    const relative = message?.text.indexOf(item.quote) ?? -1;
    const original = originals.find((m) => m.number === item.messageNumber);
    const start = relative + (message?.offset ?? 0);
    if (
      !message ||
      !original ||
      relative < 0 ||
      !item.quote.trim() ||
      original.text.slice(start, start + item.quote.length) !== item.quote
    )
      throw new Error(`素材「${item.title}」引用不在选中消息中，整批未保存`);
    const { messageNumber, quote, ...content } = item;
    return materialSchema.parse({
      ...content,
      schemaVersion: 1,
      id: `personal:${crypto.randomUUID()}`,
      origin: 'dialogue',
      method: 'ai',
      quote,
      source: {
        label: `聊天摘录 / 第${messageNumber}条 / ${message.role === 'user' ? '玩家' : '角色'}`,
        text: original.text,
        start,
        end: start + quote.length,
        chat: {
          chatKey: capture.chatKey,
          messageNumber,
          role: message.role,
          speaker: message.speaker,
          transcript: capture.transcript,
        },
      },
    });
  });
}
