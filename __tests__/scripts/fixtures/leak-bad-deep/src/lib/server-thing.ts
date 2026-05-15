import { readFile } from 'node:fs/promises';
export async function readThing() { return readFile('x', 'utf8'); }
export const SHARED = 1;
