import 'server-only';
import { readFile } from 'node:fs/promises';
export async function read() { return readFile('x', 'utf8'); }
