import type { GuideController } from './controller';
import type { ContextSnapshot } from '../host/tavern';
import { builtinMaterials, extractMaterial, type MaterialInput } from '../domain/materials';
import { ChatMaterialsController } from './chat-materials';

/** 素材不挂接故事版本或聊天进度；只使用捕获的账号、角色身份。 */
export class MaterialsController {
  constructor(
    private app: GuideController,
    private snapshot: ContextSnapshot,
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
      characterKey: this.snapshot.characterKey,
      materials: cards.filter((card) => card.origin === 'dialogue'),
      favorites,
    };
  }
}
