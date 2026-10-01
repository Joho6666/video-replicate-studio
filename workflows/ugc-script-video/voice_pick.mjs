// Finds a MOSI library voice by (part of) its name and reads the opening line with it, so the voice
// can be heard before the whole script is re-voiced. Costs one line of TTS.
// Usage: node voice_pick.mjs "<voice name>" "<line to read>" [seconds]   (MOSS_API_KEY from env)
import { writeFileSync, mkdirSync } from 'node:fs';
const DIR = (process.env.PROJECT_DIR||process.cwd().split(String.fromCharCode(92)).join('/'));
const KEY = process.env.MOSS_API_KEY;
if (!KEY) throw new Error('MOSS_API_KEY is not set');
const name = process.argv[2];
const H = { Authorization: `Bearer ${KEY}` };
const list = await (await fetch('https://api.mosi.cn/v1/audio/voices', { headers: H })).json();
const voices = list.data || list.voices || [];
const hits = voices.filter(v => String(v.name || '').includes(name));
console.log(`${voices.length} voices, ${hits.length} match "${name}":`, hits.map(v => `${v.name} ${v.id}`).join(' | '));
if (!hits.length) process.exit(1);
const voice = hits[0];
mkdirSync(`${DIR}/voices`, { recursive: true });
const text = process.argv[3] || "Hello, this is a short voice test.";
const seconds = Number(process.argv[4] || 4);
const res = await fetch('https://api.mosi.cn/v1/audio/speech', {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'moss-tts-1.5-flash', input: text, voice_id: voice.id, language: 'English', expected_duration_sec: seconds, response_format: 'mp3' }),
});
if (!res.ok) throw new Error(`TTS HTTP ${res.status} ${await res.text()}`);
writeFileSync(`${DIR}/voices/pick_line1.mp3`, Buffer.from(await res.arrayBuffer()));
writeFileSync(`${DIR}/assets/voice_selected.json`, JSON.stringify({ voice_id: voice.id, name: voice.name }, null, 2));
console.log('preview → voices/pick_line1.mp3; selected voice saved to assets/voice_selected.json');
