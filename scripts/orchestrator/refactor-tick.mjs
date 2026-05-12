#!/usr/bin/env node
// TM-94 — Recurring refactor scheduler tick.
//
// Idempotent. Intended to be invoked at the top of every Orchestrator iter
// (see .claude/commands/orchestrate.md Step 1). Cron-job–free: state lives in
// .agent-state/refactor-cron.json and is consulted on every tick.
//
// Algorithm:
//   1) Load .agent-state/refactor-cron.json.
//   2) If now < last_run_at + period_days → exit 0 (no-op, telemetry line).
//   3) Else: pick focus = focus_rotation[rotation_index % len].
//      week_counter++ ; rotation_index = (rotation_index+1) % len.
//      Call `task-master add-task` with manual title/description/details.
//      Persist last_run_at=now + push history entry.
//
// Flags:
//   --dry-run        : print plan, don't spawn / mutate state
//   --force          : ignore period gate (still advances rotation + state)
//   --state=<path>   : override state file (test isolation)
//   --tasks=<path>   : override tasks.json path (passed to task-master -f)
//   --json           : emit single-line JSON result on stdout (for orchestrator consumption)
//
// Exit codes:
//   0 = ok (spawned or no-op)
//   1 = unrecoverable error (corrupt state, task-master failure)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const out = { dryRun: false, force: false, json: false, state: null, tasks: null };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--state=')) out.state = a.slice(8);
    else if (a.startsWith('--tasks=')) out.tasks = a.slice(8);
    else if (a === '-h' || a === '--help') {
      console.log(
        'Usage: refactor-tick.mjs [--dry-run] [--force] [--json] [--state=PATH] [--tasks=PATH]',
      );
      process.exit(0);
    } else {
      console.error(`[refactor-tick] unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

function log(obj) {
  // human-readable telemetry; orchestrate.md greps for `[refactor-tick]`.
  if (obj.event) {
    const extras = Object.entries(obj)
      .filter(([k]) => k !== 'event')
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    console.log(`[refactor-tick] ${obj.event} ${extras}`.trim());
  }
}

function main() {
  const args = parseArgs(process.argv);
  const statePath = resolve(REPO_ROOT, args.state || '.agent-state/refactor-cron.json');
  const tasksPath = args.tasks ? resolve(REPO_ROOT, args.tasks) : null;

  if (!existsSync(statePath)) {
    console.error(`[refactor-tick] state file missing: ${statePath}`);
    process.exit(1);
  }

  let state;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (e) {
    console.error(`[refactor-tick] state parse failed: ${e.message}`);
    process.exit(1);
  }

  const required = ['last_run_at', 'period_days', 'rotation_index', 'week_counter', 'focus_rotation'];
  for (const k of required) {
    if (!(k in state)) {
      console.error(`[refactor-tick] state missing key: ${k}`);
      process.exit(1);
    }
  }

  const now = new Date();
  const last = new Date(state.last_run_at);
  const periodMs = state.period_days * 24 * 60 * 60 * 1000;
  const dueAt = new Date(last.getTime() + periodMs);
  const due = now >= dueAt;

  if (!due && !args.force) {
    log({
      event: 'noop',
      reason: 'not_due',
      last_run_at: state.last_run_at,
      due_at: dueAt.toISOString(),
      remaining_h: Math.round((dueAt - now) / 3600 / 1000),
    });
    if (args.json) {
      process.stdout.write(JSON.stringify({ status: 'noop', due_at: dueAt.toISOString() }) + '\n');
    }
    return;
  }

  const rotation = state.focus_rotation;
  if (!Array.isArray(rotation) || rotation.length === 0) {
    console.error('[refactor-tick] focus_rotation empty');
    process.exit(1);
  }
  const idx = ((state.rotation_index % rotation.length) + rotation.length) % rotation.length;
  const focus = rotation[idx];
  const nextWeek = state.week_counter + 1;

  const title = `Refactor week ${nextWeek}: ${focus.slug}`;
  const description = `자동 등록 (TM-94 scheduler) — week ${nextWeek} 주제: ${focus.title}. ` +
    `scope=${focus.scope}. 도구: ${(focus.tools || []).join(', ')}.`;
  const details = [
    `# Auto-spawned by TM-94 refactor scheduler`,
    ``,
    `- week: ${nextWeek}`,
    `- focus slug: ${focus.slug}`,
    `- focus title: ${focus.title}`,
    `- scope: ${focus.scope}`,
    `- recommended tools: ${(focus.tools || []).join(', ')}`,
    `- triggered_at: ${now.toISOString()}`,
    ``,
    `## 작업 가이드`,
    `1. 위 도구로 baseline 리포트 생성 → \`wiki/05-reports/\` 에 첨부.`,
    `2. 발견 항목 우선순위화 (impact × effort).`,
    `3. 상위 N건만 처리 (timeboxed 1 day). 나머지는 follow-up task로 분리.`,
    `4. PR + 회고 (\`wiki/05-reports/YYYY-MM-DD-refactor-week-${nextWeek}-${focus.slug}.md\`).`,
    ``,
    `이 task는 TM-94 의 3일 주기 cron 으로 자동 생성됨. 비활성화하려면 \`.agent-state/refactor-cron.json\` 의 period_days 를 변경하거나 파일을 제거.`,
  ].join('\n');

  if (args.dryRun) {
    log({ event: 'dry_run', title, week: nextWeek, focus: focus.slug });
    if (args.json) {
      process.stdout.write(
        JSON.stringify({ status: 'dry_run', title, week: nextWeek, focus: focus.slug }) + '\n',
      );
    }
    return;
  }

  // Invoke task-master add-task (manual mode — no AI cost).
  const tmArgs = [
    'add-task',
    '--title', title,
    '--description', description,
    '--details', details,
    '--priority', 'medium',
  ];
  if (tasksPath) tmArgs.push('-f', tasksPath);

  const tm = spawnSync('task-master', tmArgs, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
  });

  if (tm.status !== 0) {
    console.error(`[refactor-tick] task-master add-task failed (exit=${tm.status})`);
    if (tm.stdout) console.error(tm.stdout);
    if (tm.stderr) console.error(tm.stderr);
    process.exit(1);
  }

  // task-master add-task prints the new id; try to capture it. Fall back to scanning tasks.json.
  const stdout = (tm.stdout || '') + (tm.stderr || '');
  let spawnedId = null;
  const m = stdout.match(/(?:task|ID|id)[^\d]{0,8}(\d{1,5})/i);
  if (m) spawnedId = parseInt(m[1], 10);
  if (!spawnedId) {
    // Fallback: read tasks.json and pick max id.
    const tjPath = tasksPath || resolve(REPO_ROOT, '.taskmaster/tasks/tasks.json');
    try {
      const tj = JSON.parse(readFileSync(tjPath, 'utf8'));
      const list = tj?.master?.tasks || tj?.tasks || [];
      spawnedId = list
        .map((t) => parseInt(t.id, 10))
        .filter((n) => Number.isFinite(n))
        .reduce((a, b) => Math.max(a, b), 0);
    } catch (e) {
      console.error(`[refactor-tick] could not parse tasks.json to recover id: ${e.message}`);
    }
  }

  // Mutate state.
  state.last_run_at = now.toISOString();
  state.week_counter = nextWeek;
  state.rotation_index = (idx + 1) % rotation.length;
  state.history = state.history || [];
  state.history.push({
    at: now.toISOString(),
    week: nextWeek,
    focus_slug: focus.slug,
    spawned_task_id: spawnedId,
    title,
  });
  // Trim history to last 24 entries (~2 months at 3d cadence).
  if (state.history.length > 24) {
    state.history = state.history.slice(-24);
  }

  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

  log({
    event: 'spawned',
    week: nextWeek,
    focus: focus.slug,
    task_id: spawnedId,
    title,
  });
  if (args.json) {
    process.stdout.write(
      JSON.stringify({
        status: 'spawned',
        task_id: spawnedId,
        title,
        week: nextWeek,
        focus: focus.slug,
      }) + '\n',
    );
  }
}

main();
