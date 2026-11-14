import { z } from 'zod';
import { materialSchema } from './materials';

/** 独立交换格式，原始消息与AI归纳分开；不作为可执行故事导入。 */
export const chatArchiveSchema = z
  .object({
    format: z.literal('story-guide-chat-archive'),
    schemaVersion: z.literal(1),
    id: z.string().min(1).max(180),
    characterKey: z.string().min(1).max(1000),
    characterName: z.string().max(200),
    chatKey: z.string().min(1).max(1000),
    transcript: z.string().min(1).max(100),
    createdAt: z.string().datetime(),
    title: z.string().trim().min(1).max(160).optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(12).optional(),
    status: z.enum(['raw', 'complete', 'partial']),
    completedBatches: z.number().int().nonnegative(),
    totalBatches: z.number().int().nonnegative(),
    error: z.string().max(2000).optional(),
    messages: z
      .array(
        z
          .object({
            number: z.number().int().positive(),
            role: z.enum(['user', 'character']),
            speaker: z.string().max(160),
            text: z.string().min(1).max(20000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    materials: z.array(materialSchema).max(200),
  })
  .strict()
  .superRefine((archive, context) => {
    if (archive.messages.reduce((size, message) => size + message.text.length, 0) > 1000000)
      context.addIssue({ code: 'custom', path: ['messages'], message: '原文归档最多1000000字符，没有截断' });
    if (new Set(archive.messages.map((message) => message.number)).size !== archive.messages.length)
      context.addIssue({ code: 'custom', path: ['messages'], message: '消息序号不能重复' });
  });
export type ChatArchive = z.infer<typeof chatArchiveSchema>;

export function chatArchiveFileName(archive: Pick<ChatArchive, 'characterName' | 'id'>): string {
  const name = archive.characterName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 48) || '角色';
  return `story-guide-${name}-${archive.id}.json`;
}
