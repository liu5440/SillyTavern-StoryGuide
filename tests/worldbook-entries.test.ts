import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWorldbookEntries } from '../src/host/worldbook-entries.ts';
import { createLibrary, importSources } from '../src/application/library.ts';

test('所有异常分支使用有界诊断键，重复超长ID不阻断有效条目入库', () => {
  const long = 'x'.repeat(181);
  const result = readWorldbookEntries(
    [
      ['0', { uid: 1, content: '有效' }],
      ['1', { uid: long, content: '超长' }],
      ['2', { uid: long, content: '重复超长' }],
      [long, { content: 42 }],
    ],
    'embedded',
    '内嵌世界书',
  );
  assert.equal(result.sources.length, 1);
  assert.equal(result.issues.length, 3);
  assert.ok(result.issues.every((issue) => issue.sourceKey.length <= 180));
  const lib = importSources(createLibrary('alice'), result.sources, result.issues);
  assert.equal(lib.sources.length, 1);
  assert.equal(lib.reports[0]!.state, 'partial');
});

test('标准化后的超长ID或标签逐条报错，不污染同批有效来源', () => {
  const result = readWorldbookEntries(
    [
      ['0', { uid: 1, content: '有效' }],
      ['1', { uid: 'x'.repeat(181), content: '无效ID' }],
      ['2', { uid: 2, comment: 'x'.repeat(20001), content: '无效标签' }],
    ],
    'embedded',
    '内嵌世界书',
  );
  assert.equal(result.sources.length, 1);
  assert.equal(result.issues.length, 2);
});

test('单个损坏条目不丢弃同书有效资料，异常保留条目定位', () => {
  const result = readWorldbookEntries(
    [
      ['a', { content: '有效原文', comment: '背景' }],
      ['b', { content: 42 }],
      ['c', { content: '另一条原文', disable: true }],
    ],
    'book:测试',
    '测试',
  );
  assert.deepEqual(
    result.sources.map((s) => s.text),
    ['有效原文', '另一条原文'],
  );
  assert.equal(result.sources[1]?.disabled, true);
  assert.equal(result.issues[0]?.sourceKey, 'book:测试:b');
  assert.equal(result.issues[0]?.code, 'invalid_entry');
  assert.equal(result.issues.length, 1);
});

test('内嵌UID在重排后保持定位，无UID保留明确下标回退', () => {
  const entries: [string, unknown][] = [['0', { uid: 12, content: '原文' }]];
  const first = readWorldbookEntries(entries, 'embedded', '内嵌世界书');
  const next = readWorldbookEntries([['9', entries[0]![1]]], 'embedded', '内嵌世界书');
  assert.equal(first.sources[0]?.id, next.sources[0]?.id);
  assert.equal(
    readWorldbookEntries([['2', { content: '原文' }]], 'embedded', '内嵌世界书').sources[0]?.id,
    'embedded:2',
  );
});

test('重复UID保留首条并报告冲突，不产生重复来源ID', () => {
  const result = readWorldbookEntries(
    [
      ['0', { uid: 1, content: '首条' }],
      ['1', { uid: 1, content: '冲突' }],
    ],
    'embedded',
    '内嵌世界书',
  );
  assert.equal(result.sources.length, 1);
  assert.equal(result.issues.length, 1);
});
