import type {
  ClarifyChoice,
  ClarifyQuestion,
  ClarifyResponse,
  GenerateApiResponse,
  GeneratedAsset,
} from '@/types';

describe('clarify types', () => {
  it('ClarifyChoice has id + label', () => {
    const c: ClarifyChoice = { id: 'sales', label: '매출' };
    expect(c.id).toBe('sales');
    expect(c.label).toBe('매출');
  });

  it('ClarifyQuestion has id, question, choices', () => {
    const q: ClarifyQuestion = {
      id: 'data_kind',
      question: '데이터 종류는?',
      choices: [
        { id: 'sales', label: '매출' },
        { id: 'users', label: '사용자수' },
      ],
    };
    expect(q.choices).toHaveLength(2);
  });

  it('ClarifyResponse holds questions list', () => {
    const r: ClarifyResponse = {
      questions: [
        { id: 'q1', question: '?', choices: [{ id: 'a', label: 'A' }] },
      ],
    };
    expect(r.questions).toHaveLength(1);
  });

  it('GenerateApiResponse discriminates by type', () => {
    const clarify: GenerateApiResponse = {
      type: 'clarify',
      questions: [{ id: 'q1', question: 'x', choices: [{ id: 'a', label: 'A' }] }],
    };
    const generate: GenerateApiResponse = {
      type: 'generate',
      asset: {} as GeneratedAsset,
    };
    expect(clarify.type).toBe('clarify');
    expect(generate.type).toBe('generate');
    if (clarify.type === 'clarify') {
      expect(clarify.questions).toBeDefined();
    }
  });
});
