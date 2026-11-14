import type { GuideController } from './controller';
import type { ContextSnapshot } from '../host/tavern';
import {
  builtinMaterials,
  extractMaterial,
  materialSchema,
  type Material,
  type MaterialInput,
} from '../domain/materials';
import { ChatMaterialsController } from './chat-materials';
import { LibraryRepository } from '../storage/library-repository';
import { deriveScenes, previewMaterialBackup, type SceneEdit } from '../domain/scene-operations';

/** 素材不挂接故事版本或聊天进度；只使用捕获的账号、角色身份。 */
export class MaterialsController {
  constructor(
    private app: GuideController,
    private snapshot: ContextSnapshot,
    private libraries = new LibraryRepository(),
  ) {}
  guard() {
    this.app.guard(this.snapshot);
  }
  chatController() {
    return new ChatMaterialsController(this.app.host, this.app.repository, this.snapshot);
  }
  watchChat(changed: () => void) {
    return this.app.host.subscribe(changed, changed);
  }
  async archives() {
    this.guard();
    const rows = await this.app.repository.loadChatArchives(this.snapshot.user, this.snapshot.characterKey);
    this.guard();
    return rows;
  }
  async removeArchive(id: string) {
    this.guard();
    await this.app.repository.removeChatArchive(this.snapshot.user, this.snapshot.characterKey, id);
    this.guard();
  }
  async load() {
    this.guard();
    const [personal, favorites] = await Promise.all([
      this.app.repository.loadMaterials(this.snapshot.user, this.snapshot.characterKey),
      this.app.repository.loadMaterialFavorites(this.snapshot.user, this.snapshot.characterKey),
    ]);
    this.guard();
    return { cards: [...builtinMaterials, ...personal], favorites };
  }
  async save(input: MaterialInput) {
    this.guard();
    const card = extractMaterial(input);
    await this.app.repository.saveMaterial(this.snapshot.user, this.snapshot.characterKey, card);
    this.guard();
  }
  async favorite(id: string, value: boolean) {
    const { cards } = await this.load();
    if (!cards.some((card) => card.id === id)) throw new Error('素材已不存在，请重新打开');
    await this.app.repository.setMaterialFavorite(this.snapshot.user, this.snapshot.characterKey, id, value);
    this.guard();
  }
  async update(card: Material, expected?: Material, stillOpen: () => void = () => {}) {
    this.guard();
    const valid = materialSchema.parse(card);
    await this.app.repository.updateMaterial(
      this.snapshot.user,
      this.snapshot.characterKey,
      valid,
      () => {
        this.guard();
        stillOpen();
      },
      undefined,
      expected,
    );
    this.guard();
  }
  async links() {
    this.guard();
    const lib = await this.libraries.load(this.snapshot.user, this.snapshot.characterKey);
    this.guard();
    return lib;
  }
  async setLinks(card: Material, events: string[], routes: string[], stillOpen: () => void = () => {}) {
    stillOpen();
    const lib = await this.links();
    if (
      events.some((id) => !lib?.events.some((event) => event.id === id)) ||
      routes.some((id) => !lib?.routes.some((route) => route.id === id))
    )
      throw new Error('关联事件或路线不存在，请重新选择');
    await this.update(
      { ...card, relatedEventIds: [...new Set(events)], relatedRouteIds: [...new Set(routes)] },
      card,
      stillOpen,
    );
  }
  async history(id: string) {
    this.guard();
    const rows = await this.app.repository.loadMaterialHistory(
      this.snapshot.user,
      this.snapshot.characterKey,
      id,
    );
    this.guard();
    return rows;
  }
  async remove(id: string) {
    this.guard();
    await this.app.repository.removeMaterial(this.snapshot.user, this.snapshot.characterKey, id);
    this.guard();
  }
  async backup() {
    const { cards, favorites } = await this.load();
    return {
      format: 'story-guide-materials',
      schemaVersion: 1,
      user: this.snapshot.user,
      characterKey: this.snapshot.characterKey,
      materials: cards.filter((card) => card.origin === 'dialogue'),
      favorites,
    };
  }
  async derive(sources: Material[], edits: SceneEdit[], stillOpen: () => void) {
    this.guard();
    const cards = deriveScenes(sources, edits);
    await this.app.repository.saveMaterialCopies(
      this.snapshot.user,
      this.snapshot.characterKey,
      cards,
      sources,
      [],
      () => {
        this.guard();
        stillOpen();
      },
    );
    this.guard();
  }
  async previewBackup(text: string) {
    const { cards } = await this.load();
    return previewMaterialBackup(text, this.snapshot.user, this.snapshot.characterKey, cards);
  }
  async importBackup(preview: ReturnType<typeof previewMaterialBackup>, stillOpen: () => void) {
    this.guard();
    await this.app.repository.saveMaterialCopies(
      this.snapshot.user,
      this.snapshot.characterKey,
      preview.cards,
      [],
      preview.favorites,
      () => {
        this.guard();
        stillOpen();
      },
    );
    this.guard();
  }
}
