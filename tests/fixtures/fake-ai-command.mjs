import { setTimeout as sleep } from 'node:timers/promises';

const sleepArgument = process.argv.find((argument) => argument.startsWith('--sleep='));
if (sleepArgument) {
  await sleep(Number(sleepArgument.slice('--sleep='.length)));
}

if (process.argv.includes('--version')) {
  process.stdout.write('fake-ai-command 1.0.0\n');
  process.exit(0);
}

let prompt = '';
for await (const chunk of process.stdin) {
  prompt += chunk;
}

const classification = prompt.toLocaleLowerCase('en-US').includes('pikachu')
  ? 'brand_ip'
  : 'product_niche';
const output = JSON.stringify({ classification, received: prompt });
if (process.argv.includes('--text')) {
  process.stdout.write(`result: ${output}\n`);
} else {
  process.stdout.write(`${output}\n`);
}
