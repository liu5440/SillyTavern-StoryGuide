import { z } from 'zod';
import { materialSeeds } from './material-seeds';

export const materialCategories = { outfit: '服装', pose: '姿态', interaction: '互动', scene: '场景' };
const categorySchema = z.enum(['outfit', 'pose', 'interaction', 'scene']);
const sourceSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    text: z.string().min(1).max(20000),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    chat: z
      .object({
        chatKey: z.string().min(1).max(1000),
        messageNumber: z.number().int().positive(),
        role: z.enum(['user', 'character']),
        speaker: z.string().max(160),
        transcript: z.string().min(1).max(100),
      })
      .strict()
      .optional(),
  })
  .strict();
export const materialIdSchema = z
  .string()
  .regex(/^(builtin|personal):[a-zA-Z0-9-]+$/)
  .max(180);
export const materialContentSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    category: categorySchema,
    tags: z.array(z.string().trim().min(1).max(30)).max(10),
    description: z.string().trim().min(1).max(2000),
    opening: z.string().trim().min(1).max(2000),
  })
  .strict();
export const materialSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: materialIdSchema,
    ...materialContentSchema.shape,
    origin: z.enum(['builtin', 'dialogue']),
    method: z.literal('ai').optional(),
    quote: z.string().max(2000),
    source: sourceSchema.optional(),
  })
  .strict()
  .superRefine((card, ctx) => {
    if (card.origin === 'builtin') {
      if (!card.id.startsWith('builtin:') || card.source || card.quote || card.method)
        ctx.addIssue({ code: 'custom', message: '内置原创不能伪造来源' });
    } else if (
      !card.id.startsWith('personal:') ||
      !card.source ||
      card.source.start >= card.source.end ||
      card.source.end > card.source.text.length ||
      !card.quote.trim() ||
      card.quote !== card.source.text.slice(card.source.start, card.source.end)
    ) {
      ctx.addIssue({ code: 'custom', message: '摘录必须对应对话中的有效选区' });
    }
    if (card.method === 'ai' && !card.source?.chat)
      ctx.addIssue({ code: 'custom', message: 'AI素材缺少聊天来源' });
  });
export type Material = z.infer<typeof materialSchema>;
export type MaterialCategory = z.infer<typeof categorySchema>;
export type MaterialInput = Pick<
  Material,
  'id' | 'title' | 'category' | 'tags' | 'description' | 'opening'
> & { source: z.infer<typeof sourceSchema> };

/** 摘录必须由原文选区得到；描述与开场属于用户改编，不能当成原文事实。 */
export function extractMaterial(input: MaterialInput): Material {
  const source = sourceSchema.parse(input.source);
  return materialSchema.parse({
    ...input,
    schemaVersion: 1,
    origin: 'dialogue',
    quote: source.text.slice(source.start, source.end),
    source,
  });
}
export const builtinMaterials: Material[] = materialSeeds.map((card) =>
  materialSchema.parse({ ...card, schemaVersion: 1, origin: 'builtin', quote: '' }),
);
export function filterMaterials(
  cards: Material[],
  category: MaterialCategory | 'all',
  query: string,
): Material[] {
  const key = query.trim().toLocaleLowerCase();
  return cards.filter(
    (card) =>
      (category === 'all' || card.category === category) &&
      [card.title, card.description, card.opening, ...card.tags].join('\n').toLocaleLowerCase().includes(key),
  );
}
export function materialText(card: Material): string {
  return `${card.title}\n${materialCategories[card.category]} · ${card.tags.join(' / ')}\n${card.origin === 'builtin' ? '内置原创素材 · 非角色原设定' : card.method === 'ai' ? 'AI归纳 / 原创开场 · 非原文事实' : '用户改编 · 非角色原设定'}\n${card.description}\n剧情开场：${card.opening}`;
}
