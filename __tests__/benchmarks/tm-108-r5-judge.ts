/**
 * TM-108 r5 — judge-only pass for partial captures (cases 2,3 only).
 * Bench was interrupted at case 4; this re-judges the 2 captured items using
 * the same rubric/model as tm-108-bench.ts.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });

const ROOT = path.join(__dirname, 'results', 'tm-108', 'full');
const SHOTS = path.join(ROOT, 'screenshots');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const SCORES_PATH = path.join(ROOT, 'scores.json');
const FRAMES = [90, 180];
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? 'gpt-4o';

const SYSTEM_PROMPT = `너는 Remotion 으로 만든 모션 그래픽 산출물을 채점하는 시각 디자인 전문가다.
입력은 한 프롬프트에 대한 2개 프레임(중간/끝)이고, 각 프레임을 4축 1-10점으로 채점한다.

축 정의:
1. layout (레이아웃 균형): 배치/여백/시각 무게.
2. typography (타이포 가독성): 폰트 크기, 대비, 위계, 일관성.
3. motion (모션 자연스러움): 2 프레임 진행이 자연스러운지 (정지/회귀 감점).
4. fidelity (프롬프트 부합도): 원 프롬프트 키워드(주제/색상/숫자/길이) 반영.

반드시 아래 JSON 스키마로만 답하라:
{
  "frames": [
    {"frame": 90,  "layout": <1-10>, "typography": <1-10>, "motion": <1-10>, "fidelity": <1-10>, "comment": "<짧은 한국어>"},
    {"frame": 180, ...}
  ],
  "overall_comment": "<한국어 1-2 문장>",
  "improvement_suggestion": "<프롬프트/템플릿/렌더 개선안 1-2 문장>"
}`;

async function main() {
  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const scored: any[] = [];
  for (const it of MANIFEST.items) {
    if (!it.framesCaptured || it.framesCaptured.length < 2) continue;
    const images: { frame: number; b64: string }[] = [];
    for (const f of FRAMES) {
      const p = path.join(SHOTS, `${it.id}-${f}.png`);
      if (!fs.existsSync(p)) { continue; }
      images.push({ frame: f, b64: fs.readFileSync(p).toString('base64') });
    }
    if (images.length < 2) continue;
    const userContent: any[] = [
      { type: 'text', text: `프롬프트(원문): "${it.prompt}"\n카테고리: ${it.category}\n첨부: 2 프레임 (90=중간, 180=끝).` },
      ...images.flatMap((img) => [
        { type: 'text', text: `Frame ${img.frame}:` },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${img.b64}` } },
      ]),
    ];
    process.stdout.write(`[judge] ${it.id} ... `);
    const r = await oai.chat.completions.create({
      model: JUDGE_MODEL, max_tokens: 400, temperature: 0, seed: 42,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    });
    const text = r.choices[0]?.message?.content ?? '';
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { console.log('parse-fail'); continue; }
    const sums = parsed.frames.reduce((a: any, f: any) => ({
      layout: a.layout + f.layout, typography: a.typography + f.typography,
      motion: a.motion + f.motion, fidelity: a.fidelity + f.fidelity,
    }), { layout: 0, typography: 0, motion: 0, fidelity: 0 });
    const n = parsed.frames.length;
    const overall = Math.round(((sums.layout + sums.typography + sums.motion + sums.fidelity) / (4 * n)) * 10);
    scored.push({
      id: it.id, category: it.category,
      overall_score: overall,
      axis_avg: {
        layout: Math.round((sums.layout / n) * 10) / 10,
        typography: Math.round((sums.typography / n) * 10) / 10,
        motion: Math.round((sums.motion / n) * 10) / 10,
        fidelity: Math.round((sums.fidelity / n) * 10) / 10,
      },
      judge: parsed,
      generationMs: it.generationMs,
    });
    console.log(`overall=${overall}`);
  }
  const avg = scored.length ? Math.round((scored.reduce((s, r) => s + r.overall_score, 0) / scored.length) * 10) / 10 : 0;
  fs.writeFileSync(SCORES_PATH, JSON.stringify({
    mode: 'full',
    ran_at: new Date().toISOString(),
    n: scored.length,
    avg_overall: avg,
    note: 'r5 partial — bench interrupted at case 4 (Scene2 EB on chart); cases 1 (500 regression), 4 (incomplete), 5 (not run) omitted from judge.',
    results: scored,
  }, null, 2));
  console.log(`[done] n=${scored.length} avg=${avg}`);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
