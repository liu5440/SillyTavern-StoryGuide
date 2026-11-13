import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterGroups } from '../src/domain/character-groups';
import { buildLocalCatalog } from '../src/application/local-catalog';
import { fixture } from './fixtures';
import { parseStory } from '../src/domain/story';
import type { ContextSnapshot } from '../src/host/tavern';

test('按人物字段归类，多人事件同时出现，公共资料不丢失且不改写原故事', () => {
  const data = fixture();
  data.nodes[0]!.characters = ['青岚', '白榆'];
  data.nodes[1]!.characters = [];
  const story = parseStory(data);
  const before = JSON.stringify(story);
  const groups = characterGroups(story);
  assert.deepEqual(groups.find((group) => group.label === '青岚')?.nodeIds, ['a']);
  assert.deepEqual(groups.find((group) => group.label === '白榆')?.nodeIds, ['a']);
  assert.deepEqual(groups.find((group) => group.key === 'unassigned')?.nodeIds, ['b']);
  assert.equal(JSON.stringify(story), before);
});

test('无AI目录按姓名字段与提及归类，不把所有短标题当成人物', () => {
  const texts = [
    { label: '世界书 / 青岚', text: '姓名：青岚\n性格：沉稳\n外貌：长发' },
    { label: '世界书 / 白榆', text: '{"姓名":"白榆","身份":"调查员"}' },
    { label: '世界书 / 会面事件', text: '青岚与白榆在钟楼会面。' },
    { label: '世界书 / 案件索引', text: '案件索引与调查规则。' },
  ];
  const snapshot: ContextSnapshot = {
    user: 'u',
    characterKey: 'c',
    characterName: '多人角色卡',
    chatKey: 'chat',
    bookNames: [],
    api: 'test',
    transcript: '',
    sources: texts.map((item, i) => ({ ...item, id: `s${i}`, disabled: false, fingerprint: 'f' })),
  };
  const groups = characterGroups(buildLocalCatalog(snapshot));
  assert.deepEqual(groups.find((group) => group.label === '青岚')?.nodeIds, ['source-1', 'source-3']);
  assert.deepEqual(groups.find((group) => group.label === '白榆')?.nodeIds, ['source-2', 'source-3']);
  assert.deepEqual(groups.find((group) => group.key === 'unassigned')?.nodeIds, ['source-4']);
  assert.equal(
    groups.some((group) => group.label === '案件索引'),
    false,
  );
});

test('普通角色卡字段标题和规则不误识别为子角色', () => {
  const story = parseStory(fixture());
  story.sources[0] = { ...story.sources[0]!, label: '角色卡 / 人物描述', text: '性格：沉稳。外貌：长发。' };
  story.nodes.forEach((node) => {
    node.characters = [];
  });
  assert.deepEqual(
    characterGroups(story).map((group) => group.key),
    ['all', 'unassigned'],
  );
  story.sources[0] = {
    ...story.sources[0]!,
    id: 'card:personality',
    label: '角色卡 / 性格',
    text: '性格：沉稳；身份：调查员',
  };
  assert.deepEqual(
    characterGroups(story).map((group) => group.key),
    ['all', 'unassigned'],
  );
});

test('长目录按完整来源归类，人物字段在摘录之后也不遗漏', () => {
  const text = `${'资料正文。'.repeat(4000)}\n姓名：青岚\n身份：调查员`;
  const snapshot: ContextSnapshot = {
    user: 'u',
    characterKey: 'c',
    characterName: '测试',
    chatKey: 'chat',
    bookNames: [],
    api: 'test',
    transcript: '',
    sources: [{ id: 'long', label: '世界书 / 长篇档案', text, disabled: false, fingerprint: 'f' }],
  };
  const story = buildLocalCatalog(snapshot);
  assert.equal(story.nodes[0]?.summary.includes('青岚'), false);
  assert.deepEqual(characterGroups(story).find((group) => group.label === '青岚')?.nodeIds, ['source-1']);
});
