'use server';
import { read } from '@/lib/db';
export async function doIt() { return read(); }
