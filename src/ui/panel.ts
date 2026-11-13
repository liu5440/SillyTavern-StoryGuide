import { GuideController, decodeImport } from '../application/controller';
import { GenerationError, splitSources } from '../application/generate';
import {
  parseStory,
  validateGraph,
  visibleStory,
  type Story,
  type StoryNode,
  type Edge,
  type RunState,
} from '../domain/story';
import type { ContextSnapshot } from '../host/tavern';
import { el, button, check, field, showModal, download } from './dom';
import { graph } from './graph';
import { MaterialsController } from '../application/materials';
import { openMaterials } from './materials';
import { openDiagnostics } from './diagnostics';
import { buildLocalCatalog } from '../application/local-catalog';
import { characterGroups } from '../domain/character-groups';
import { sourceSelection, sourceCatalog } from './source-selection';

const provenance = { explicit: '原文明确', inferred: '模型推断', original: '原创故事', user: '用户设定' };
const kinds = { start: '开场', event: '事件', choice: '选择', ending: '结局' };

/** 面板只编排输入和展示，模型与存储操作均交给应用用例。 */
export class GuidePanel {
  private dialog = el('dialog', 'sg-panel');
  private status = el('p', 'sg-status', '准备读取角色资料…');
  private body = el('div', 'sg-body');
  private sidebar = el('aside', 'sg-sidebar');
  private content = el('main', 'sg-content');
  private output = el('div', 'sg-output');
  private title = el('h2', '', '剧情指南');
  private snapshot?: ContextSnapshot;
  private story?: Story;
  private stories: Story[] = [];
  private run?: RunState;
  private undo: RunState[] = [];
  private readonly spoilers = true;
  private characterFilter = 'all';
  private grouping?: { story: Story; groups: ReturnType<typeof characterGroups> };
  private dirty = false;
  private tab = '概览';
  private query = '';
  private busy = false;
  private saving = false;
  private abort?: AbortController;
  private selectedSources = new Set<string>();
  private loadId = 0;
  private returnFocus?: HTMLElement;
  private unsubscribe: () => void;
  private bubble = button('剧情手册', () => this.restore(), 'sg-guide-bubble');
  constructor(private app: GuideController) {
    const header = el('header', 'sg-header');
    const heading = el('div');
    heading.append(el('span', 'sg-brand', 'STORY GUIDE / 剧情手册'), this.title);
    header.append(
      heading,
      button('资料设置', () => {
        this.dialog.classList.toggle('sg-show-settings');
        this.renderContent();
        this.body.scrollTop = 0;
      }),
      button('放大', () => {
        const large = this.dialog.classList.toggle('sg-expanded');
        const toggle = this.dialog.querySelector<HTMLButtonElement>('[data-layout-toggle]');
        if (toggle) toggle.textContent = large ? '悬浮阅读' : '放大';
      }),
      button('收起', () => {
        this.dialog.classList.add('sg-minimized');
        this.bubble.hidden = false;
        this.bubble.focus();
      }),
      button('排查日志', openDiagnostics),
      button('场景素材库', () =>
        this.safe(() => {
          if (!this.snapshot) throw new Error('请先打开角色聊天并等待读取完成');
          this.guardView(this.snapshot);
          openMaterials(new MaterialsController(this.app, this.snapshot));
        }),
      ),
      button('关闭', () => {
        if (!this.dirty || confirm('草稿尚未保存，关闭后更改不会保留。继续？')) this.dialog.close();
      }),
    );
    const layoutToggle = [...header.querySelectorAll('button')].find(
      (button) => button.textContent === '放大',
    );
    if (layoutToggle) layoutToggle.dataset.layoutToggle = '';
    const transport = el('select');
    transport.setAttribute('aria-label', '模型调用方式');
    for (const [value, label] of [
      ['raw', '后台非流式（原方式）'],
      ['compatible', '兼容调用（跟随酒馆流式设置）'],
    ] as const) {
      const option = el('option', '', label);
      option.value = value;
      transport.append(option);
    }
    transport.value = this.app.host.getTransport();
    transport.addEventListener('change', () => {
      void this.safe(() => {
        try {
          this.app.host.setTransport(transport.value === 'compatible' ? 'compatible' : 'raw');
        } finally {
          transport.value = this.app.host.getTransport();
        }
        this.message(
          '调用方式已切换；聊天素材整理也使用此设置。单次请求6000 token输出预算，可能增加用量；不改全局回复长度，不自动重试。',
        );
      });
    });
    const footer = el('footer', 'sg-phone-nav');
    const tools = el('details', 'sg-phone-tools');
    tools.append(el('summary', '', '更多'));
    const toolItems = el('div', 'sg-phone-tool-items');
    const settings = [...header.querySelectorAll('button')].find((item) => item.textContent === '资料设置');
    for (const item of [...header.querySelectorAll('button')]) {
      if (item === settings || item.textContent === '收起' || item.textContent === '关闭') continue;
      toolItems.append(item);
    }
    toolItems.append(transport);
    tools.append(toolItems);
    footer.append(
      button('阅读', () => {
        this.dialog.classList.remove('sg-show-settings');
        tools.open = false;
        this.renderContent();
        this.body.scrollTop = 0;
      }),
    );
    if (settings) footer.append(settings);
    footer.append(tools);
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.body.append(this.sidebar, this.content);
    this.dialog.append(header, this.status, this.body, footer);
    this.dialog.addEventListener('cancel', (event) => {
      if (this.dirty && !confirm('草稿尚未保存，关闭后更改不会保留。继续？')) event.preventDefault();
      else this.abort?.abort();
    });
    this.dialog.addEventListener('close', () => {
      this.bubble.hidden = true;
      this.abort?.abort();
      this.closeEditors();
      this.returnFocus?.focus();
    });
    this.dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (!this.dirty || confirm('草稿尚未保存，关闭后更改不会保留。继续？')) this.dialog.close();
    });
    this.dialog.classList.add('sg-floating');
    this.dialog.setAttribute('aria-label', '剧情手册');
    this.bubble.hidden = true;
    document.body.append(this.dialog, this.bubble);
    this.unsubscribe = this.app.host.subscribe(
      () => {
        this.abort?.abort();
        this.loadId++;
        this.closeEditors();
        if (this.dialog.open) {
          this.story = undefined;
          this.run = undefined;
          this.content.replaceChildren();
          this.sidebar.replaceChildren();
          this.message('聊天已切换，正在重新读取…');
          void this.safe(() => this.load());
        }
      },
      () => {
        if (this.run) {
          this.run.needsReview = true;
          this.message('聊天内容已修改，本局进度需要核对；确认后可继续记录。');
          this.renderContent();
        }
      },
    );
  }
  destroy() {
    this.abort?.abort();
    this.closeEditors();
    this.unsubscribe();
    this.dialog.remove();
    this.bubble.remove();
  }
  private closeEditors() {
    document.querySelectorAll<HTMLDialogElement>('.sg-modal').forEach((dialog) => dialog.close());
  }
  private guardView(snapshot: ContextSnapshot, expectedStory?: Story) {
    this.app.guard(snapshot);
    if (snapshot !== this.snapshot || !this.dialog.open) throw new Error('页面已重新读取，已丢弃旧操作结果');
    if (expectedStory && expectedStory !== this.story)
      throw new Error('故事已被编辑或切换，当前修改已保留；旧操作结果可从存档列表查看');
  }
  open() {
    if (this.dialog.open) {
      this.restore();
      return;
    }
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.dialog.classList.remove('sg-minimized');
    this.dialog.show();
    void this.safe(() => this.load());
  }
  private restore() {
    this.dialog.classList.remove('sg-minimized');
    this.bubble.hidden = true;
    this.title.tabIndex = -1;
    this.title.focus();
  }
  private message(text: string, error = false) {
    this.status.textContent = text;
    this.status.classList.toggle('sg-error', error);
  }
  private async safe(action: () => void | Promise<void>) {
    try {
      await action();
    } catch (error) {
      this.message(error instanceof Error ? error.message : '操作失败，请重试', true);
    }
  }
  private async persist(snapshot: ContextSnapshot, story: Story, adopt: boolean) {
    if (this.saving) throw new Error('正在保存，请等待完成');
    this.saving = true;
    this.message('正在保存版本与本局进度…');
    try {
      const saved = adopt ? await this.app.adopt(snapshot, story) : await this.app.save(snapshot, story);
      const stories = await this.app.repository.loadStories(snapshot.user, snapshot.characterKey);
      const run = await this.app.run(snapshot, saved);
      this.guardView(snapshot, story);
      this.story = saved;
      this.dirty = false;
      this.stories = stories;
      this.run = run;
      this.renderContent();
      this.message(
        adopt ? '故事已采用，可以手动记录本局进度；没有自动注入聊天。' : '草稿版本已保存到当前浏览器',
      );
    } finally {
      this.saving = false;
    }
  }
  private async load(books?: string[]) {
    const sequence = ++this.loadId;
    const { snapshot, stories } = await this.app.load(books);
    if (sequence !== this.loadId || !this.dialog.open) return;
    const story = stories[0];
    const run = story ? await this.app.run(snapshot, story) : undefined;
    if (sequence !== this.loadId || !this.dialog.open) return;
    this.snapshot = snapshot;
    this.stories = stories;
    this.story = story;
    this.selectedSources = new Set(snapshot.sources.filter((s) => !s.disabled).map((s) => s.id));
    this.dirty = false;
    this.undo = [];
    this.characterFilter = 'all';
    this.query = '';
    this.run = run;
    this.title.textContent = `${snapshot.characterName}的剧情指南`;
    await this.renderSidebar();
    if (sequence !== this.loadId || !this.dialog.open) return;
    this.renderContent();
    this.message(
      `${snapshot.sources.length} 条资料已读取 · 使用酒馆当前 ${snapshot.api} 连接生成 · 存档仅在当前浏览器`,
    );
  }
  private async renderSidebar() {
    if (!this.snapshot) return;
    this.sidebar.replaceChildren();
    const snapshot = this.snapshot;
    this.sidebar.append(
      el('h3', '', '准备故事'),
      el('p', 'sg-muted', '整理已有设定，或为角色写一段可探索的故事。'),
    );
    const mode = el('select');
    mode.setAttribute('aria-label', '生成模式');
    for (const [value, label] of [
      ['analyze', '解析原设定'],
      ['create', '创作新故事'],
    ]) {
      const option = el('option', '', label);
      option.value = value ?? '';
      mode.append(option);
    }
    mode.value =
      snapshot.bookNames.length || snapshot.sources.some((s) => s.id.startsWith('embedded:'))
        ? 'analyze'
        : 'create';
    const brief = field('故事意向（可选）', '', true);
    brief.input.placeholder = '例如：慢热悬疑，先共同调查，再分成人物路线。也可补充人物设定。';
    const options = await this.app.host.bookOptions();
    if (snapshot !== this.snapshot) return;
    const books = el('details', 'sg-details');
    books.append(el('summary', '', '当前角色关联世界书'));
    const selectedBooks = new Set(snapshot.bookNames);
    for (const name of options.all)
      books.append(
        check(name, selectedBooks.has(name), (yes) => {
          if (yes) selectedBooks.add(name);
          else selectedBooks.delete(name);
        }).root,
      );
    if (!options.all.length)
      books.append(
        el('p', 'sg-muted', '没有外部关联书；内嵌世界书已自动读取。也可在酒馆为当前角色绑定世界书。'),
      );
    books.append(
      button('读取所选世界书', () =>
        this.safe(async () => {
          if (this.busy) throw new Error('请先结束当前生成');
          if (this.dirty && !confirm('有未保存草稿，重新读取会丢弃更改。继续？')) return;
          await this.load([...selectedBooks]);
        }),
      ),
    );
    const sourceList = sourceSelection(snapshot.sources, this.selectedSources);
    const generate = button(
      '生成故事草稿',
      () =>
        this.safe(async () => {
          if (this.busy) throw new Error('已有生成任务，请等待或取消');
          if (this.dirty && !confirm('有未保存更改，生成新草稿前是否继续？旧存档不会覆盖。')) return;
          const selected = snapshot.sources.filter((s) => this.selectedSources.has(s.id));
          const count = splitSources(selected).length;
          if (
            !confirm(
              `将发送 ${selected.length} 条所选资料（${selected.reduce((n, s) => n + s.text.length, 0)} 字符）至酒馆当前模型。${mode.value === 'analyze' ? `预计 ${count}${count > 1 ? ' + 1 次合并' : ''} 次请求` : '预计 1 次请求'}，校验失败可能额外修复一次。继续？`,
            )
          )
            return;
          this.busy = true;
          const previousStory = this.story;
          generate.disabled = true;
          this.abort = new AbortController();
          try {
            const story = await this.app.generate(
              {
                snapshot: { ...snapshot, sources: selected },
                mode: mode.value === 'create' ? 'create' : 'analyze',
                brief: brief.input.value,
              },
              this.abort.signal,
              (text) => this.message(text),
            );
            this.guardView(snapshot);
            const run = await this.app.run(snapshot, story);
            this.guardView(snapshot);
            if (this.story !== previousStory)
              throw new Error('生成期间故事已被编辑或切换，当前修改已保留，请重新生成');
            this.story = story;
            this.run = run;
            this.dirty = true;
            this.characterFilter = 'all';
            this.message('草稿已生成，尚未保存或采用。打开完整攻略可编辑事件与分支。');
            this.renderContent();
          } catch (error) {
            if (
              error instanceof GenerationError &&
              error.partials.length &&
              this.app.host.isCurrent(snapshot)
            ) {
              for (const partial of error.partials)
                await this.app.repository.saveStory(snapshot.user, {
                  ...partial,
                  title: `部分结果：${partial.title}`,
                });
              const stories = await this.app.repository.loadStories(snapshot.user, snapshot.characterKey);
              this.guardView(snapshot);
              this.stories = stories;
              this.renderContent();
            }
            throw error;
          } finally {
            this.busy = false;
            this.abort = undefined;
            generate.disabled = false;
          }
        }),
      'sg-primary',
    );
    const updateGenerateLabel = () => {
      generate.textContent = mode.value === 'analyze' ? 'AI分析事件与路线' : '生成故事草稿';
    };
    mode.addEventListener('change', updateGenerateLabel);
    updateGenerateLabel();
    const cancel = button('取消生成', () => {
      this.abort?.abort();
      this.message('已请求取消。酒馆模型请求可能继续执行和计费，返回内容不会采用。');
    });
    const localCatalog = button('建立本地资料目录（无需AI）', () =>
      this.safe(async () => {
        if (this.busy || this.saving) throw new Error('请先结束当前操作');
        if (this.dirty && !confirm('本地目录将替换当前未保存草稿，继续？')) return;
        this.guardView(snapshot);
        const story = buildLocalCatalog({
          ...snapshot,
          sources: snapshot.sources.filter((source) => this.selectedSources.has(source.id)),
        });
        const previous = this.story;
        const run = await this.app.run(snapshot, story);
        this.guardView(snapshot);
        if (this.busy || this.story !== previous) throw new Error('当前故事已变化，请重新建立目录');
        this.story = story;
        this.run = run;
        this.dirty = true;
        this.tab = '事件';
        this.query = '';
        this.characterFilter = 'all';
        mode.value = 'analyze';
        updateGenerateLabel();
        this.message(
          `已建立${story.nodes.length}条本地资料目录，未调用AI。需要自动梳理先后与分支，可点击“AI分析事件与路线”；将另建草稿供你审阅。`,
        );
        this.renderContent();
      }),
    );
    this.sidebar.append(mode, brief.root, books, sourceList, localCatalog, generate, cancel);
    const footer = el('div', 'sg-sidebar-footer');
    const upload = el('input');
    upload.type = 'file';
    upload.accept = '.json,application/json';
    upload.hidden = true;
    upload.addEventListener(
      'change',
      () =>
        void this.safe(async () => {
          const file = upload.files?.[0];
          if (!file) return;
          if (file.size > 8_000_000) throw new Error('文件超过 8 MB');
          const raw = await file.text();
          this.guardView(snapshot);
          const decoded = decodeImport(raw);
          const preview = decoded.story;
          const errors = validateGraph(preview);
          if (errors.length) throw new Error(errors.join('；'));
          showModal('导入预览', (body, close) => {
            const restore = check('同时恢复备份进度到当前聊天（需重新核对）', false);
            if (decoded.run) body.append(restore.root);
            body.append(
              el('h3', '', preview.title),
              el(
                'p',
                '',
                `${preview.nodes.length} 个节点、${preview.edges.length} 条连线。将作为当前角色的新草稿保存，不覆盖已有版本。`,
              ),
              button(
                '另存为新故事',
                () =>
                  this.safe(async () => {
                    const imported = await this.app.importStory(snapshot, raw);
                    const run =
                      restore.input.checked && decoded.run
                        ? await this.app.restoreRun(snapshot, imported, decoded.run)
                        : await this.app.run(snapshot, imported);
                    const stories = await this.app.repository.loadStories(
                      snapshot.user,
                      snapshot.characterKey,
                    );
                    this.guardView(snapshot);
                    this.story = imported;
                    this.run = run;
                    this.dirty = false;
                    this.stories = stories;
                    close();
                    this.renderContent();
                    this.message('导入副本已保存');
                  }),
                'sg-primary',
              ),
            );
          });
          upload.value = '';
        }),
    );
    footer.append(
      button('导入故事 JSON', () => upload.click()),
      upload,
      el('p', 'sg-muted', '生成只产生草稿，不会发送聊天或改写角色卡。换浏览器前请导出备份。'),
    );
    this.sidebar.append(footer);
  }
  private groupsFor(story: Story) {
    if (!this.grouping || this.grouping.story !== story)
      this.grouping = { story, groups: characterGroups(story) };
    return this.grouping.groups;
  }
  private renderContent() {
    this.content.replaceChildren();
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const actions = el('div', 'sg-toolbar');
    if (this.stories.length) {
      const select = el('select');
      select.setAttribute('aria-label', '故事存档版本');
      this.stories.forEach((s, i) => {
        const option = el(
          'option',
          '',
          `${s.title} / v${s.revision} ${s.status === 'adopted' ? '已采用' : '草稿'}`,
        );
        option.value = String(i);
        option.selected = this.story?.id === s.id && this.story.revision === s.revision;
        select.append(option);
      });
      if (this.dirty) {
        const option = el('option', '', '当前未保存草稿');
        option.value = '-1';
        option.selected = true;
        select.append(option);
      }
      select.addEventListener(
        'change',
        () =>
          void this.safe(async () => {
            if (this.dirty && !confirm('切换会丢弃当前未保存更改。继续？')) {
              this.renderContent();
              return;
            }
            const story = this.stories[Number(select.value)];
            if (!story) return;
            const previousStory = this.story;
            const run = await this.app.run(snapshot, story);
            this.guardView(snapshot);
            if (this.story !== previousStory) throw new Error('故事已被编辑或切换，已保留当前版本');
            this.story = story;
            this.run = run;
            this.dirty = false;
            this.undo = [];
            this.characterFilter = 'all';
            this.query = '';
            this.renderContent();
          }),
      );
      actions.append(select);
    }
    actions.classList.add('sg-version-actions');
    this.content.append(actions);
    const story = this.story;
    if (!story) {
      const empty = el('div', 'sg-welcome');
      empty.append(
        el('span', 'sg-book-mark', '✦'),
        el('h2', '', '先读懂这个世界，再走进故事'),
        el(
          'p',
          '',
          '点击“资料设置”选择资料，解析角色已有的经历与路线。没有世界书？也可以从人物出发，创作共同线、分支和结局。',
        ),
        el('p', 'sg-muted', '默认展示完整攻略；生成后先审阅草稿，再采用为游玩依据。'),
      );
      this.content.append(empty);
      return;
    }
    const heading = el('div', 'sg-story-heading');
    heading.append(
      el('h2', '', story.title),
      el(
        'span',
        'sg-badge',
        `${story.mode === 'analyze' ? '原设定解析' : '故事创作'} / ${this.dirty ? '未保存' : story.status === 'adopted' ? '已采用' : '草稿'} v${story.revision}`,
      ),
    );
    this.content.append(heading);
    const saveActions = el('div', 'sg-toolbar');
    saveActions.append(
      button('保存草稿版本', () => this.safe(() => this.persist(snapshot, story, false))),
      button('采用此故事', () => this.safe(() => this.persist(snapshot, story, true)), 'sg-primary'),
      button('导出故事', () => download(`剧情指南-${story.id}-v${story.revision}.json`, story)),
    );
    saveActions.append(
      button('备份故事与本局进度', () =>
        download(`剧情备份-${story.id}.json`, {
          format: 'story-guide-backup',
          schemaVersion: 1,
          story,
          ...(this.run ? { run: this.run } : {}),
        }),
      ),
    );
    const storyActions = el('details', 'sg-story-actions');
    storyActions.open = this.dialog.classList.contains('sg-show-settings');
    storyActions.append(el('summary', '', '故事操作'), saveActions);
    this.content.append(storyActions);
    if (this.run?.needsReview)
      this.content.append(el('p', 'sg-warning', '聊天内容已变动，本局进度待核对。确认节点后可继续记录。'));
    if (
      story.sources.some((old) => {
        const source = snapshot.sources.find((s) => s.id === old.id);
        return !source || source.fingerprint !== old.fingerprint;
      })
    )
      this.content.append(
        el(
          'p',
          'sg-warning',
          '原资料已变化或不在当前读取范围。此版本保留旧来源快照；重新生成不会覆盖旧存档。',
        ),
      );
    const nav = el('nav', 'sg-tabs');
    for (const label of ['概览', '事件', '地点', '路线图'])
      nav.append(
        button(
          label,
          () => {
            this.tab = label;
            this.renderContent();
          },
          this.tab === label ? 'sg-active' : '',
        ),
      );
    this.content.append(nav);
    storyActions.append(
      button(`查看原始资料（${story.sources.length}）`, () =>
        showModal('原始资料 · 不代表事件', (body) => body.append(sourceCatalog(story.sources))),
      ),
    );
    const groups = this.groupsFor(story);
    if (!groups.some((group) => group.key === this.characterFilter)) this.characterFilter = 'all';
    const filters = el('section', 'sg-character-groups');
    filters.setAttribute('aria-label', '按子角色查看');
    filters.append(el('h3', '', '按子角色查看'));
    const chips = el('div', 'sg-character-chips');
    const picker = el('select', 'sg-character-picker');
    picker.setAttribute('aria-label', '选择查看的人物');
    for (const group of groups) {
      const option = el('option', '', `${group.label}（${group.nodeIds.length}）`);
      option.value = group.key;
      picker.append(option);
    }
    picker.value = this.characterFilter;
    picker.addEventListener('change', () => {
      this.characterFilter = picker.value;
      this.renderContent();
    });
    filters.append(picker);
    for (const group of groups) {
      const chip = button(
        `${group.label}（${group.nodeIds.length}）`,
        () => {
          this.characterFilter = group.key;
          this.renderContent();
          for (const next of this.content.querySelectorAll<HTMLButtonElement>('[data-character-group]')) {
            if (next.dataset.characterGroup === group.key) next.focus();
          }
        },
        group.key === this.characterFilter ? 'sg-active' : '',
      );
      chip.dataset.characterGroup = group.key;
      chip.setAttribute('aria-pressed', String(group.key === this.characterFilter));
      chips.append(chip);
    }
    filters.append(
      chips,
      el(
        'small',
        'sg-muted',
        '优先按已标注人物分组；无人物字段时按姓名或人物档案及原文提及筛选。未明确归属的资料保留在公共／未分类，不代表路线判定。',
      ),
    );
    this.content.append(filters);
    const search = field('搜索可见事件、人物、地点', this.query);
    search.root.classList.add('sg-read-search');
    search.input.placeholder = '搜索人物、资料或事件';
    search.input.addEventListener('input', () => {
      this.query = search.input.value;
      this.renderOutput();
    });
    this.content.append(search.root);
    this.output = el('div', 'sg-output');
    this.content.append(this.output);
    this.renderOutput();
  }
  private renderOutput() {
    this.output.replaceChildren();
    if (!this.story) return;
    const view = visibleStory(this.story, this.run, this.spoilers);
    const selectedGroup = this.groupsFor(this.story).find((group) => group.key === this.characterFilter);
    const nodeIds = new Set(selectedGroup?.nodeIds ?? view.nodes.map((node) => node.id));
    const nodes = view.nodes.filter(
      (n) =>
        nodeIds.has(n.id) &&
        `${n.title} ${n.summary} ${n.location} ${n.characters.join(' ')}`.includes(this.query),
    );
    if (this.tab === '概览') {
      this.output.append(el('p', 'sg-synopsis', view.summary));
      if (this.run) {
        const current = view.nodes.find((n) => n.id === this.run?.current);
        this.output.append(
          el('h3', '', '这一次，从这里开始'),
          el('p', '', current ? `当前：${current.title}` : '尚未设置当前事件'),
        );
        const destinations = view.edges.filter((e) => e.from === this.run?.current);
        for (const edge of destinations)
          this.output.append(
            el('p', 'sg-next', `${edge.label || '继续探索'} · 条件：${edge.condition || '需玩家判断'}`),
          );
        const progressActions = el('div', 'sg-toolbar sg-progress-actions');
        progressActions.append(
          button('查看互动建议', () => this.suggestions(view)),
          button('本局选择与变量', () => this.runEditor()),
          button('撤销上次进度', () =>
            this.safe(async () => {
              const old = this.undo.at(-1),
                snapshot = this.snapshot;
              if (!old || !snapshot) return;
              await this.app.saveRun(snapshot, old);
              this.guardView(snapshot);
              this.undo.pop();
              this.run = old;
              this.renderContent();
            }),
          ),
        );
        this.output.append(progressActions);
      }
      this.output.append(el('h3', '', '可探索事件'));
    }
    if (this.tab === '路线图') {
      this.output.append(
        graph(
          {
            ...view,
            nodes,
            edges: view.edges.filter(
              (e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to),
            ),
          },
          this.run?.current ?? '',
          (id) => this.nodeDetail(id),
          (id) => this.edgeDetail(id),
          this.spoilers
            ? (id, x, y) => {
                if (this.story) {
                  this.story = { ...this.story, positions: { ...this.story.positions, [id]: { x, y } } };
                  this.dirty = true;
                  this.message('布局已调整，点击保存草稿版本可持久保存');
                }
              }
            : undefined,
        ),
      );
      if (this.spoilers) {
        const graphActions = el('div', 'sg-toolbar');
        graphActions.append(
          button('添加事件', () => this.nodeDetail()),
          button('添加连线', () => this.edgeDetail()),
        );
        this.output.append(graphActions);
      }
      return;
    }
    if (this.tab === '地点') {
      const locations = [...new Set(nodes.map((n) => n.location || '未标地点'))];
      for (const location of locations) {
        const group = el('section', 'sg-place');
        group.append(el('h3', '', location));
        for (const node of nodes.filter((n) => (n.location || '未标地点') === location))
          group.append(this.nodeRow(node));
        this.output.append(group);
      }
    } else for (const node of nodes) this.output.append(this.nodeRow(node));
    if (!nodes.length)
      this.output.append(
        el('p', 'sg-empty', '当前人物分类或搜索下没有匹配资料，可切换“全部资料”或清空搜索。'),
      );
    if (this.spoilers) this.output.append(button('添加事件', () => this.nodeDetail()));
  }
  private nodeRow(node: StoryNode): HTMLElement {
    const row = button('', () => this.nodeDetail(node.id), 'sg-event-row');
    row.append(
      el(
        'span',
        'sg-node-type',
        node.chapter === '原始资料（不代表事件）'
          ? '原始资料 · 不代表事件'
          : `${kinds[node.type]} · ${node.time || '时间未知'}`,
      ),
      el('strong', '', node.title),
      el('span', 'sg-event-summary', node.summary),
      el(
        'small',
        'sg-muted',
        `${node.location || '地点未知'} · ${provenance[node.provenance]}${this.run?.states[node.id] === 'done' ? ' · 已完成' : ''}`,
      ),
    );
    return row;
  }
  private suggestions(view: Story) {
    const node = view.nodes.find((n) => n.id === this.run?.current) ?? view.nodes[0];
    showModal('互动建议', (body) => {
      if (!node) {
        body.append(el('p', '', '请先设置一个可见的当前事件。'));
        return;
      }
      const advice = `可以围绕「${node.title}」询问${node.characters.join('、') || '角色'}的想法${node.location ? `，或提议一起探索${node.location}` : ''}。当前情境：${node.summary}`;
      body.append(
        el('p', 'sg-badge', '规则生成的互动建议 · 不保证触发事件'),
        el('p', '', advice),
        button('复制建议', () =>
          this.safe(async () => {
            await navigator.clipboard.writeText(advice);
            this.message('建议已复制，没有发送聊天');
          }),
        ),
      );
      for (const edge of view.edges.filter((e) => e.from === node.id))
        body.append(el('p', '', `${edge.label}：${edge.condition || '需玩家判断'}`));
    });
  }
  private runEditor() {
    const run = this.run,
      story = this.story,
      snapshot = this.snapshot;
    if (!run || !story || !snapshot) return;
    showModal('本局选择与变量', (body, close) => {
      const choices = new Set(run.choices);
      const view = visibleStory(story, run, this.spoilers);
      body.append(el('h3', '', '已做出的选择'));
      for (const edge of view.edges)
        body.append(
          check(edge.label || '继续探索', choices.has(edge.id), (yes) => {
            if (yes) choices.add(edge.id);
            else choices.delete(edge.id);
          }).root,
        );
      const variables = field(
        '变量（JSON 对象，值仅支持数字、布尔或字符串）',
        JSON.stringify(run.variables, null, 2),
        true,
      );
      body.append(
        variables.root,
        el('p', 'sg-muted', '本版条件由玩家判断，记录变量不会自动推进事件。'),
        button(
          '保存本局记录',
          () =>
            this.safe(async () => {
              if (story.status !== 'adopted' || this.dirty) throw new Error('请先采用故事，再记录进度');
              const next = {
                ...run,
                choices: [...choices],
                variables: JSON.parse(variables.input.value) as RunState['variables'],
                needsReview: false,
              };
              await this.app.saveRun(snapshot, next);
              this.guardView(snapshot);
              this.undo.push(structuredClone(run));
              this.run = next;
              close();
              this.renderContent();
              this.message('本局记录已保存');
            }),
          'sg-primary',
        ),
      );
    });
  }
  private nodeDetail(id?: string) {
    const story = this.story,
      snapshot = this.snapshot,
      run = this.run;
    if (!story || !snapshot) return;
    const original = story.nodes.find((n) => n.id === id);
    if (!this.spoilers && (!original || !visibleStory(story, this.run, false).nodes.some((n) => n.id === id)))
      return;
    showModal(original?.title ?? '添加事件', (body, close) => {
      if (original && !this.spoilers) {
        body.append(
          el('p', 'sg-badge', provenance[original.provenance]),
          el('p', '', original.summary),
          el('p', '', `时间：${original.time || '未知'} · 地点：${original.location || '未知'}`),
        );
      } else {
        const name = field('事件标题', original?.title ?? '新事件');
        const summary = field('故事内容', original?.summary ?? '', true);
        const location = field('地点', original?.location ?? '');
        const time = field('时间（不确定请写未知）', original?.time ?? '未知');
        const chapter = field('章节/路线', original?.chapter ?? '');
        const characters = field('相关人物（用顿号分隔）', original?.characters.join('、') ?? '');
        const type = el('select');
        type.setAttribute('aria-label', '节点类型');
        for (const [value, label] of Object.entries(kinds)) {
          const option = el('option', '', label);
          option.value = value;
          type.append(option);
        }
        type.value = original?.type ?? 'event';
        const hidden = check('未来事件或秘密（默认隐藏）', original?.spoiler ?? true);
        const locked = check('锁定内容，局部生成时保留', original?.locked ?? false);
        body.append(
          name.root,
          summary.root,
          location.root,
          time.root,
          chapter.root,
          characters.root,
          type,
          hidden.root,
          locked.root,
        );
        if (original)
          body.append(
            button('局部重生成（预览后替换）', () =>
              this.safe(async () => {
                this.guardView(snapshot);
                if (this.busy) throw new Error('请先结束当前生成任务');
                this.busy = true;
                this.abort = new AbortController();
                const timer = setTimeout(() => this.abort?.abort(), 180000);
                try {
                  this.message('正在重新整理此节点…');
                  const next = await this.app.regenerate(snapshot, story, original.id, this.abort.signal);
                  this.guardView(snapshot, story);
                  showModal('节点修改预览', (preview, done) => {
                    preview.append(
                      el('h3', '', '修改前'),
                      el('p', '', original.summary),
                      el('h3', '', '修改后'),
                      el(
                        'p',
                        '',
                        `${next.title}\n${next.summary}\n地点：${next.location}\n时间：${next.time}`,
                      ),
                      button(
                        '替换到草稿',
                        () =>
                          this.safe(() => {
                            this.guardView(snapshot, story);
                            this.story = {
                              ...story,
                              nodes: story.nodes.map((n) => (n.id === original.id ? next : n)),
                            };
                            this.dirty = true;
                            done();
                            close();
                            this.renderContent();
                            this.message('节点已替换到草稿，尚未保存');
                          }),
                        'sg-primary',
                      ),
                    );
                  });
                } finally {
                  clearTimeout(timer);
                  this.busy = false;
                  this.abort = undefined;
                }
              }),
            ),
          );
        body.append(
          button(
            '更新草稿',
            () =>
              this.safe(() => {
                this.guardView(snapshot);
                const updated: StoryNode = {
                  id: original?.id ?? crypto.randomUUID(),
                  type: type.value as StoryNode['type'],
                  title: name.input.value,
                  summary: summary.input.value,
                  location: location.input.value,
                  time: time.input.value,
                  chapter: chapter.input.value,
                  characters: characters.input.value.split('、').filter(Boolean),
                  provenance: 'user',
                  refs: [],
                  spoiler: hidden.input.checked,
                  locked: locked.input.checked,
                };
                const copy = structuredClone(story);
                const index = copy.nodes.findIndex((n) => n.id === updated.id);
                if (index >= 0) copy.nodes[index] = updated;
                else copy.nodes.push(updated);
                this.story = parseStory(copy);
                this.dirty = true;
                close();
                this.renderContent();
                this.message('事件已更新到草稿，尚未保存');
              }),
            'sg-primary',
          ),
        );
        if (original)
          body.append(
            button('删除事件及关联连线', () => {
              if (!confirm('删除后可通过旧存档恢复，继续？')) return;
              const copy = structuredClone(story);
              copy.nodes = copy.nodes.filter((n) => n.id !== original.id);
              copy.edges = copy.edges.filter((e) => e.from !== original.id && e.to !== original.id);
              if (!copy.nodes.length) {
                this.message('至少保留一个事件', true);
                return;
              }
              this.story = copy;
              this.dirty = true;
              close();
              this.renderContent();
            }),
          );
      }
      if (original) {
        body.append(el('h3', '', '本局进度'));
        for (const [label, state] of [
          ['设为当前事件', 'current'],
          ['标记已完成', 'done'],
          ['标记跳过', 'skipped'],
          ['重置为未发生', 'pending'],
        ])
          body.append(
            button(label ?? '', () =>
              this.safe(async () => {
                this.guardView(snapshot);
                if (!run) return;
                if (this.story?.status !== 'adopted' || this.dirty)
                  throw new Error('请先保存并采用故事，再记录本局进度');
                const old = structuredClone(run);
                const next = structuredClone(run);
                if (state === 'current') next.current = original.id;
                else next.states[original.id] = state as 'done' | 'skipped' | 'pending';
                next.needsReview = false;
                await this.app.saveRun(snapshot, next);
                this.guardView(snapshot);
                this.undo.push(old);
                this.run = next;
                close();
                this.renderContent();
                this.message('本局进度已保存');
              }),
            ),
          );
        if (this.spoilers) {
          body.append(el('h3', '', '原文依据'));
          if (!original.refs.length)
            body.append(el('p', 'sg-muted', '没有原文引用。此项为推断、原创或用户设定。'));
          for (const ref of original.refs) {
            const source = story.sources.find((s) => s.id === ref.sourceId);
            body.append(el('strong', '', source?.label ?? '来源缺失'), el('blockquote', '', ref.quote));
          }
          body.append(el('h3', '', '后续分支'));
          for (const edge of story.edges.filter((e) => e.from === original.id))
            body.append(
              button(`${edge.label || '继续'} · ${edge.condition || '需玩家判断'}`, () =>
                this.edgeDetail(edge.id),
              ),
            );
        }
      }
    });
  }
  private edgeDetail(id?: string) {
    const snapshot = this.snapshot;
    if (!this.story || !this.spoilers || !snapshot) return;
    const story = this.story;
    const edge = story.edges.find((e) => e.id === id);
    showModal('编辑分支连线', (body, close) => {
      const from = el('select'),
        to = el('select');
      from.setAttribute('aria-label', '起点');
      to.setAttribute('aria-label', '终点');
      for (const node of story.nodes)
        for (const select of [from, to]) {
          const option = el('option', '', node.title);
          option.value = node.id;
          select.append(option);
        }
      from.value = edge?.from ?? story.nodes[0]?.id ?? '';
      to.value = edge?.to ?? story.nodes[1]?.id ?? '';
      const label = field('选择或衔接文本', edge?.label ?? '继续');
      const condition = field('剧情条件（人工判断）', edge?.condition ?? '需玩家判断', true);
      body.append(
        el('p', 'sg-muted', '起点与终点决定剧情流向，条件不会执行脚本。'),
        from,
        to,
        label.root,
        condition.root,
        button(
          '更新连线',
          () =>
            this.safe(() => {
              this.guardView(snapshot);
              const updated: Edge = {
                id: edge?.id ?? crypto.randomUUID(),
                from: from.value,
                to: to.value,
                label: label.input.value,
                condition: condition.input.value,
                provenance: 'user',
                refs: [],
              };
              const copy = structuredClone(story);
              const index = copy.edges.findIndex((e) => e.id === updated.id);
              if (index >= 0) copy.edges[index] = updated;
              else copy.edges.push(updated);
              const errors = validateGraph(copy).filter((e) => /环路|不存在|重复/.test(e));
              if (errors.length) throw new Error(errors.join('；'));
              this.story = copy;
              this.dirty = true;
              close();
              this.renderContent();
            }),
          'sg-primary',
        ),
      );
      if (edge)
        body.append(
          button('删除连线', () => {
            this.story = { ...story, edges: story.edges.filter((e) => e.id !== edge.id) };
            this.dirty = true;
            close();
            this.renderContent();
          }),
        );
    });
  }
}
