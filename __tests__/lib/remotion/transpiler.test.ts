import { transpileTSX } from '@/lib/remotion/transpiler';

describe('transpileTSX', () => {
  it('strips TypeScript types', async () => {
    const code = `const x: number = 5;`;
    const result = await transpileTSX(code);
    expect(result).not.toContain(': number');
    expect(result).toContain('const x');
  });

  it('transforms JSX to React.createElement', async () => {
    const code = `const el = <div className="test">hello</div>;`;
    const result = await transpileTSX(code);
    expect(result).not.toContain('<div');
    expect(result).toContain('React.createElement');
  });

  it('handles arrow functions with JSX', async () => {
    const code = `const Comp = () => <span style={{ color: 'red' }}>Hi</span>;`;
    const result = await transpileTSX(code);
    expect(result).toContain('React.createElement');
    expect(result).toMatch(/['"]span['"]/);
  });
});
