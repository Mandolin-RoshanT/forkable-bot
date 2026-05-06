// Forkable models alternatives as menus → sections → items. Most callers
// just want the flat list of items with their parent venue label, so this
// helper does the triple-loop in one place.

import type { Item, Menu } from '../schemas/forkable.ts';

export type FlatItem = { menuName: string; menuId: number; item: Item };

export function flattenItems(menus: Menu[]): FlatItem[] {
  const out: FlatItem[] = [];
  for (const menu of menus) {
    const menuName = menu.displayName ?? menu.name;
    for (const section of menu.sections) {
      for (const item of section.items) {
        out.push({ menuName, menuId: menu.id, item });
      }
    }
  }
  return out;
}
