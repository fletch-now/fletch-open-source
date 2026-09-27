export function appHue(slug: string): number {
  let hash = 0;
  for (const character of slug)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return [130, 205, 35, 275, 170, 350][hash % 6];
}
