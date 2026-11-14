import { z } from 'zod';
import { fingerprint, sourceSchema, type Source } from '../domain/story';

const entrySchema = z
  .object({
    uid: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    comment: z.string().optional(),
    name: z.string().optional(),
    content: z.string().max(300000),
    disable: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .passthrough();

export interface SourceReadIssue {
  sourceKey: string;
  label: string;
  code: 'invalid_entry';
  message: string;
}
function diagnosticKey(key: string): string {
  return key.length <= 180 ? key : `invalid:${fingerprint(key)}`;
}

/** 单条资料损坏只记录可定位异常，不抛弃整本书，日志不包含原文。 */
export function readWorldbookEntries(
  entries: [string, unknown][],
  prefix: string,
  label: string,
): {
  sources: Source[];
  issues: SourceReadIssue[];
} {
  const sources: Source[] = [];
  const issues: SourceReadIssue[] = [];
  const ids = new Set<string>();
  for (const [key, raw] of entries) {
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success) {
      issues.push({
        sourceKey: diagnosticKey(`${prefix}:${key}`),
        label,
        code: 'invalid_entry',
        message: '条目字段无效或正文超过300000字符，未导入；其他条目继续读取',
      });
      continue;
    }
    const entry = parsed.data;
    const identity = prefix === 'embedded' ? (entry.uid ?? entry.id ?? key) : key;
    const id = `${prefix}:${identity}`;
    if (ids.has(id)) {
      issues.push({
        sourceKey: diagnosticKey(id),
        label,
        code: 'invalid_entry',
        message: '条目ID重复，保留首条；请检查来源',
      });
      continue;
    }
    ids.add(id);
    if (!entry.content.trim()) continue;
    const source = sourceSchema.safeParse({
      id,
      label: `${label} / ${entry.comment || entry.name || entry.uid || entry.id || '未命名条目'}`,
      text: entry.content,
      disabled: entry.disable === true || entry.enabled === false,
      fingerprint: fingerprint(entry.content),
    });
    if (!source.success) {
      issues.push({
        sourceKey: diagnosticKey(id),
        label,
        code: 'invalid_entry',
        message: '标准化后的条目ID或标签超限，未导入；其他条目继续读取',
      });
      continue;
    }
    sources.push(source.data);
  }
  return { sources, issues };
}
