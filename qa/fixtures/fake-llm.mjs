import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const fence = '```';
const questions = {
  questions: [
    { id: 'q1', text: 'Must a.ts keep exporting a?', why: 'Other code may import it.' },
    { id: 'q2', text: 'Should b.ts move before the cut?', why: 'The order decides which slice breaks the build.' },
  ],
};
const slices = {
  slices: [
    { title: 'Add the core package', slug: 'add-core', body: 'Create src/core.\n' },
    { title: 'Move b into infra', slug: 'move-b', body: 'Move src/app/b.ts to src/infra.\n' },
    { title: 'Cut app from domain', slug: 'cut-app-domain', body: '# Cut\nNo behaviour changes.\n' },
  ],
  brief: '# Reshape layered\n\nMove b, then cut app from domain.\n',
};
const questionsReply = `Some questions first.\n${fence}json\n${JSON.stringify(questions)}\n${fence}\n`;
const slicesReply = `${fence}json\n{"example":1}\n${fence}\nHere are the slices.\n${fence}json\n${JSON.stringify(slices)}\n${fence}\n`;
const badReply = `${fence}json\n{"slices": [\n${fence}\n`;
const cut = { kind: 'cut-edge', from: 'src/app', to: 'src/domain', files: [['src/app/a.ts', 'src/domain/model.ts']] };
const scanner = {
  summary: 'Pull scanning out of the ui so app has one job.',
  edits: [
    cut,
    { kind: 'create-package', path: 'src/ports' },
    { kind: 'move-file', file: 'src/app/b.ts', to: 'src/ports' },
    { kind: 'move-file', file: 'src/no-such.ts', to: 'src/ports' },
  ],
};
const keep = { summary: 'Leave scanning in app.', edits: [{ kind: 'add-edge', from: 'src/domain', to: 'src/app' }] };
const jobs = {
  summary: 'Give each job its own package.',
  edits: [
    {
      kind: 'split-package',
      package: 'src/app',
      parts: [
        { name: 'scan', files: ['src/app/a.ts'] },
        { name: 'jobs', files: ['src/app/b.ts'] },
      ],
    },
    { kind: 'move-file', file: 'src/app/scan/a.ts', to: 'src/infra' },
    { kind: 'fate', file: 'src/infra/db.ts', fate: 'delete' },
    { kind: 'note', target: { node: 'src/app' }, text: 'three jobs' },
  ],
};
const scannerReply = `Here is the plan.\n${fence}json\n{"example":1}\n${fence}\nProposed.\n${fence}json\n${JSON.stringify(scanner)}\n${fence}\n`;
const keepReply = `${fence}json\n${JSON.stringify(keep)}\n${fence}\n`;
const jobsReply = `${fence}json\n${JSON.stringify(jobs)}\n${fence}\n`;
const dislikes = (phrase) => input.includes(`## What they dislike\n${phrase}\n`);

const log = process.argv[2];
const input = readFileSync(0, 'utf8');
const n = readdirSync(log).filter((name) => name.endsWith('.prompt')).length + 1;
writeFileSync(`${log}/${n}.prompt`, input);
const env = process.env;
writeFileSync(
  `${log}/${n}.env.json`,
  JSON.stringify({
    cwd: process.cwd(),
    root: env.BINDWEED_ROOT ?? null,
    claudecode: env.CLAUDECODE ?? null,
    entrypoint: env.CLAUDE_CODE_ENTRYPOINT ?? null,
  }),
);

if (input.includes('SLEEP-NOW')) {
  const child = spawn('sleep', ['600'], { stdio: 'ignore' });
  if (child.pid === undefined) {
    process.stderr.write('sleep did not start\n');
    process.exit(1);
  }
  writeFileSync(`${log}/sleep.pids`, `${process.pid}\n${child.pid}\n`);
  setInterval(() => undefined, 1000);
} else if (input.includes('BAD-ONCE') && !existsSync(`${log}/bad.done`)) {
  writeFileSync(`${log}/bad.done`, '');
  process.stdout.write(badReply);
} else if (dislikes('keep scan where it is')) {
  process.stdout.write(keepReply);
} else if (dislikes('the ui knows about the scanner')) {
  process.stdout.write(scannerReply);
} else if (dislikes('app is doing three jobs')) {
  process.stdout.write(jobsReply);
} else if (input.includes('Reply with slices now.')) {
  process.stdout.write(slicesReply);
} else if (input.includes('ASK-AGAIN')) {
  process.stdout.write(questionsReply);
} else if (/^A: /m.test(input)) {
  process.stdout.write(slicesReply);
} else {
  process.stdout.write(questionsReply);
}
