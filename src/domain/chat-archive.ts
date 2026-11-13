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
      .max(50),
    materials: z.array(materialSchema).max(200),
  })
  .strict();
export type ChatArchive = z.infer<typeof chatArchiveSchema>;

export function chatArchiveFileName(archive: Pick<ChatArchive, 'characterName' | 'id'>): string {
  const name = archive.characterName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 48) || '角色';
  return `story-guide-${name}-${archive.id}.json`;
}
