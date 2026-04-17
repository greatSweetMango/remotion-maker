import { transform } from 'sucrase';

export async function transpileTSX(code: string): Promise<string> {
  const result = transform(code, {
    transforms: ['typescript', 'jsx'],
    jsxRuntime: 'classic',
    production: true,
  });
  return result.code;
}
