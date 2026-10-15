/**
 * Display names by character id, for pieces that only hold an id (a rolled check card's `skill_check.assist`).
 * App keeps it current from the world's characters; anything unknown shows its id.
 */
let names: Readonly<Record<string, string>> = {};

export function setCharacterNames(next: Readonly<Record<string, string>>): void {
  names = next;
}

export function characterName(id: string): string {
  return names[id] || id;
}
