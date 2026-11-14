import { parseLibrary, type StoryLibrary, type StoryRoute } from '../domain/library';
import { libraryId } from './library';

function findRoute(lib: StoryLibrary, id: string): StoryRoute {
  const route = lib.routes.find((item) => item.id === id);
  if (!route) throw new Error('路线不存在，请重新选择');
  return route;
}

/** 路线元数据与事件实体分开修改，改名和改人物不改变共享引用。 */
export function updateRoute(
  lib: StoryLibrary,
  id: string,
  patch: Partial<Pick<StoryRoute, 'title' | 'kind' | 'characters' | 'completeness'>>,
): StoryLibrary {
  findRoute(lib, id);
  return parseLibrary({
    ...lib,
    revision: lib.revision + 1,
    routes: lib.routes.map((route) =>
      route.id === id
        ? {
            ...route,
            ...patch,
            characters: [...new Set(patch.characters ?? route.characters)],
            revision: route.revision + 1,
          }
        : route,
    ),
  });
}

/** 删除路线只移除视图和引用，事件/关系仍可由其他路线或事件池管理。 */
export function deleteRoute(lib: StoryLibrary, id: string): StoryLibrary {
  findRoute(lib, id);
  return parseLibrary({
    ...lib,
    revision: lib.revision + 1,
    routes: lib.routes.filter((route) => route.id !== id),
  });
}

/** 用户主动复制路线时共享事件和关系，布局对象独立；不复制事件实体。 */
export function duplicateRoute(lib: StoryLibrary, id: string, title: string): StoryLibrary {
  const original = findRoute(lib, id);
  return parseLibrary({
    ...lib,
    revision: lib.revision + 1,
    routes: [
      ...lib.routes,
      {
        ...structuredClone(original),
        id: libraryId('route'),
        revision: 1,
        title,
      },
    ],
  });
}
