import { z } from 'zod';
import { materialContentSchema, materialSchema, type Material } from './materials';

export interface ChatMessage {
  number: number;
  role: 'user' | 'character';
  speaker: string;
  text: string;
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
    if (size > 100000) throw new Error('预览范围超过100000字符，请缩小范围；没有截断');
    messages.push({
      number: i + 1,
      role: parsed.data.is_user ? 'user' : 'character',
      speaker: parsed.data.name || (parsed.data.is_user ? '玩家' : '角色'),
      text: parsed.data.mes,
    });
  }
  return messages;
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
export function decodeChatMaterials(raw: string, capture: ChatCapture): Material[] {
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
    const message = capture.messages.find((m) => m.number === item.messageNumber);
    const start = message?.text.indexOf(item.quote) ?? -1;
    if (!message || start < 0 || !item.quote.trim())
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
        text: message.text,
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
