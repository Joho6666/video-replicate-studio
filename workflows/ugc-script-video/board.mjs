// Storyboard stills for every `still` shot in shots.json that has a prompt (MiniMax image-01).
// Shots marked `character` pass the presenter photo as a subject reference so it is the same woman.
// An existing image is never regenerated unless its id is passed with --again.
// Usage: node board.mjs [S04 S05 ...] [--again]      (no ids = all missing)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const DIR = (process.env.PROJECT_DIR||process.cwd().split(String.fromCharCode(92)).join('/'));
const KEY = process.env.MINIMAX_API_KEY;
if (!KEY) throw new Error('MINIMAX_API_KEY is not set');
mkdirSync(`${DIR}/board`, { recursive: true });
const { shots } = JSON.parse(readFileSync(`${DIR}/shots.json`, 'utf8'));
const ids = process.argv.slice(2).filter(a => !a.startsWith('--'));
const again = process.argv.includes('--again');
const presenter = `data:image/jpeg;base64,${readFileSync(`${DIR}/assets/presenter_4.jpg`).toString('base64')}`;
const LOOK = ' She is the same woman as the reference: 48 years old, shoulder-length light brown hair with soft grey strands, natural light makeup.';

const todo = shots.filter(s => s.source === 'still' && s.prompt && (ids.length ? ids.includes(s.id) : true)
  && (again || !existsSync(`${DIR}/${s.image}`)));
if (!todo.length) { console.log('nothing to generate'); process.exit(0); }
console.log(`generating ${todo.length} image(s): ${todo.map(s => s.id).join(' ')}`);

for (const s of todo) {
  const body = { model: 'image-01', prompt: s.prompt + (s.character ? LOOK : ''), aspect_ratio: '9:16', response_format: 'url', n: 1, prompt_optimizer: false };
  if (s.character) body.subject_reference = [{ type: 'character', image_file: presenter }];
  const res = await fetch('https://api.minimaxi.com/v1/image_generation', {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  const url = j.data?.image_urls?.[0];
  if (!url) { console.log(s.id, 'failed', res.status, JSON.stringify(j.base_resp || j).slice(0, 300)); continue; }
  writeFileSync(`${DIR}/${s.image}`, Buffer.from(await (await fetch(url)).arrayBuffer()));
  console.log(s.id, 'saved', s.image, JSON.stringify(j.metadata || {}));
}
