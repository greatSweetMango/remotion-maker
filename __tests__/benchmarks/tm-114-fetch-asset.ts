import { prisma } from '../../src/lib/db/prisma';
const id = process.argv[2];
prisma.asset.findUnique({ where: { id } }).then(a => {
  if (!a) { console.log('not found'); process.exit(1); }
  console.log('=== CODE ===');
  console.log(a.code);
  console.log('=== JSCODE LINES 55-75 ===');
  console.log(a.jsCode.split('\n').slice(54, 75).map((l, i) => `${i+55}: ${l}`).join('\n'));
  process.exit(0);
});
