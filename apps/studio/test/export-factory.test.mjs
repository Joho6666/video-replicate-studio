import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-export-'));
process.env.STUDIO_DATA_DIR = tmp;
process.env.FACTORY_EXPORT_DIR = path.join(tmp, 'factory-projects');
const ex = await import('../lib/export-factory.mjs');
const api = await import('../lib/board-api.mjs');
const { loadBoard, saveBoard } = await import('../lib/board.mjs');
const { jobDir } = await import('../lib/jobs.mjs');
test.after(() => rm(tmp, { recursive: true, force: true }));

// A fake ffmpeg that just creates the output file (last argument), so tests need no real media.
const calls = [];
const fakeFfmpeg = async args => { calls.push(args); await mkdir(path.dirname(args.at(-1)), { recursive: true }); await writeFile(args.at(-1), 'x'); };

test('checkLine mirrors the factory gate: banned words and numbers outside the whitelist', () => {
  assert.deepEqual(ex.checkLine('Feel lighter every day', { whitelist: [] }), []);
  assert.deepEqual(ex.checkLine('全网最好', {}), ['极限词「最」', '极限词「全网」']);
  assert.deepEqual(ex.checkLine('最会选的人', {}), [], 'the factory exception list applies');
  assert.deepEqual(ex.checkLine('Save 20 percent', { whitelist: ['20'] }), []);
  assert.deepEqual(ex.checkLine('Save 20 percent', { whitelist: ['30'] }), ['数字 20 不在白名单']);
});

test('whitelistFrom takes numbers only from the brief plus explicit extras', () => {
  assert.deepEqual(ex.whitelistFrom({ brief: { product: 'Vitamin C 500', notes: '60 capsules' } }, [48]).sort(), ['48', '500', '60']);
  assert.deepEqual(ex.whitelistFrom({}), []);
});

test('bigCard keeps one short clean line only (multi-line text crashes the factory renderer)', () => {
  assert.equal(ex.bigCard('NEW  DROP'), 'NEW DROP');
  assert.equal(ex.bigCard('one\ntwo'), 'one two');
  assert.equal(ex.bigCard('this overlay is far too long to be a card'), undefined);
  assert.equal(ex.bigCard('only 5 left', []), undefined, 'a number that is not whitelisted is dropped');
  assert.equal(ex.bigCard(''), undefined);
});

test('pickTransitions keeps every hard-cut run within the 8 s the factory can join, and starts with a cut', () => {
  const runs = (durs, t) => { let run = 0, worst = 0; durs.forEach((d, i) => { run = t[i] === 'cut' && i > 0 ? run + d + 0.12 : d + 0.12; worst = Math.max(worst, run); }); return worst; };
  for (let v = 0; v < 8; v++) {
    const durs = Array.from({ length: 30 }, (_, i) => [1.2, 3, 4.4, 7.3, 2.4][i % 5]);
    const t = ex.pickTransitions(durs, ex.rng(v + 1), v);
    assert.equal(t[0], 'cut');
    assert.equal(t.length, 30);
    assert.ok(runs(durs, t) <= Math.max(ex.MAX_CUT_RUN, 7.42), `variant ${v}: run of ${runs(durs, t)} s`);
  }
  // calm variant: cut whenever it fits, otherwise push
  assert.deepEqual(ex.pickTransitions([3, 3, 3, 3], ex.rng(1), 0), ['cut', 'cut', 'push_left', 'cut']);
  assert.ok(!ex.pickTransitions([7.5, 7.5, 7.5], ex.rng(1), 0).slice(1).includes('cut'), 'long shots are never joined');
});

test('buildScripts: reproducible, every line pinned to its clip, variants really differ', () => {
  const lines = [1, 2, 3, 4, 5].map(i => ({ key: `k${i}`, text: `line ${i}`, wav: `/w/${i}.wav` }));
  const a = ex.buildScripts(lines, { variants: 4, jobId: 'j' });
  const b = ex.buildScripts(lines, { variants: 4, jobId: 'j' });
  assert.deepEqual(a, b);
  assert.deepEqual(a.map(s => s.name), ['b001', 'b002', 'b003', 'b004']);
  for (const s of a) {
    assert.equal(s.speed, 1.0, 'real voice is not sped up');
    s.lines.forEach((l, i) => { assert.equal(l.shots[0][0], `k${i + 1}`); assert.ok(l.shots[0][1] >= 0.05 && l.shots[0][1] <= 0.3); assert.equal(l.wav, `/w/${i + 1}.wav`); });
  }
  assert.notDeepEqual(a[1].lines.map(l => l.tin), a[2].lines.map(l => l.tin));
  assert.equal(ex.buildScripts(lines, { variants: 2, jobId: 'j', music: ['/m/a.mp3', '/m/b.mp3'] })[1].music_file, '/m/b.mp3');
  assert.equal('music_file' in a[0], false);
});

async function makeJob({ voice = true, shots }) {
  const job = await api.createScriptJob({ text: 'x\ny', title: 'Demo', brief: { product: 'Brand 60', notes: 'Capsules' } });
  const root = jobDir(job.id);
  await mkdir(path.join(root, 'clips'), { recursive: true });
  await mkdir(path.join(root, 'board'), { recursive: true });
  await mkdir(path.join(root, 'voice'), { recursive: true });
  for (const f of ['clips/a.mp4', 'clips/b.mp4', 'board/S03.jpg']) await writeFile(path.join(root, f), 'x');
  if (voice) await writeFile(path.join(root, 'voice/full.wav'), 'x');
  await saveBoard(job, { version: 1, shots });
  return job;
}
const gen = (id, start, end, text, clip, extra = {}) => ({ id, start, end, text, prompt: 'p', source: { kind: 'generate', clip: { file: clip }, ...extra.source }, generate: { provider: 'h3', resolution: '768P', group: id } });

test('planExport keeps usable shots and says why each other one is skipped', async () => {
  const job = await makeJob({ shots: [
    gen('S01', 0, 5, 'Hello there', 'clips/a.mp4'),
    gen('S02', 5, 10, 'Second line', 'clips/b.mp4'),
    { id: 'S03', start: 10, end: 13, text: 'A still image', prompt: 'p', source: { kind: 'still', image: 'board/S03.jpg' } },
    { id: 'S04', start: 13, end: 16, text: 'Expert says so', prompt: '', source: { kind: 'client' } },
    gen('S05', 16, 20, 'Not generated yet', 'clips/missing.mp4'),
    gen('S06', 20, 25, '', 'clips/a.mp4'),
    gen('S07', 25, 30, '全网最低价', 'clips/a.mp4'),
    gen('S08', 30, 35, 'Save 99 now', 'clips/a.mp4'),
  ] });
  const board = await loadBoard(job);
  board.shots[1].qc = { verdict: 'FAIL' };
  await saveBoard(job, board, { trustQc: true });
  const plan = ex.planExport(job, await loadBoard(job), { whitelist: ['60'] });
  assert.deepEqual(plan.items.map(i => [i.shot.id, i.kind]), [['S01', 'video'], ['S03', 'still']]);
  const why = Object.fromEntries(plan.skipped.map(s => [s.id, s.reason]));
  assert.match(why.S02, /质检未通过/);
  assert.match(why.S04, /客户素材/);
  assert.match(why.S05, /没有生成出视频/);
  assert.match(why.S06, /没有台词/);
  assert.match(why.S07, /极限词/);
  assert.match(why.S08, /数字 99/);
});

test('exportToFactory writes a project that satisfies the factory contract and never overwrites a foreign folder', async () => {
  const job = await makeJob({ shots: [gen('S01', 0, 5, 'Hello there', 'clips/a.mp4'), gen('S02', 5, 9.5, 'Second line', 'clips/b.mp4', { source: { overlay: 'NEW' } })] });
  const outDir = path.join(tmp, 'out1');
  const res = await ex.exportToFactory(job, await loadBoard(job), { outDir, variants: 3, ffmpeg: fakeFfmpeg });
  assert.equal(res.clips, 2);
  assert.equal(res.voiced, true);
  assert.deepEqual(res.variants, ['b001', 'b002', 'b003']);
  const index = JSON.parse(await readFile(path.join(outDir, '数据', '素材索引.json'), 'utf8'));
  const keys = Object.keys(index);
  assert.equal(keys.length, 2);
  for (const e of Object.values(index)) {
    // fields the factory's render.py reads: 内容 / 类别 / 标记 / 时长 / 预览
    assert.equal(e.类别, '空镜');
    assert.deepEqual(e.标记, ['AI生成']);
    assert.ok(e.时长 > 0 && e.内容 && existsSync(e.预览));
  }
  const project = JSON.parse(await readFile(path.join(outDir, 'project.json'), 'utf8'));
  assert.deepEqual(project.number_whitelist, ['60']);
  const script = JSON.parse(await readFile(path.join(outDir, '脚本', 'b002.json'), 'utf8'));
  assert.equal(script.lines.length, 2);
  for (const l of script.lines) { assert.ok(keys.includes(l.shots[0][0])); assert.ok(existsSync(l.wav)); assert.ok(l.text); }
  assert.equal(script.lines[1].big, 'NEW');
  assert.match(await readFile(res.report, 'utf8'), /AI 生成内容/);
  assert.ok(existsSync(path.join(outDir, '.studio-export.json')));
  // re-export into the same marked folder is fine; a folder with foreign content is refused
  await ex.exportToFactory(job, await loadBoard(job), { outDir, variants: 1, ffmpeg: fakeFfmpeg });
  const foreign = path.join(tmp, 'client-project');
  await mkdir(foreign, { recursive: true });
  await writeFile(path.join(foreign, 'project.json'), '{}');
  await assert.rejects(async () => ex.exportToFactory(job, await loadBoard(job), { outDir: foreign, ffmpeg: fakeFfmpeg }), /已经有别的内容/);
  assert.equal(await readFile(path.join(foreign, 'project.json'), 'utf8'), '{}');
});

test('exportToFactory without a voice file says so, and refuses when nothing is usable or inputs are bad', async () => {
  const job = await makeJob({ voice: false, shots: [gen('S01', 0, 5, 'Hello there', 'clips/a.mp4')] });
  const out = path.join(tmp, 'out2');
  const res = await ex.exportToFactory(job, await loadBoard(job), { outDir: out, variants: 1, ffmpeg: fakeFfmpeg });
  assert.equal(res.voiced, false);
  const script = JSON.parse(await readFile(path.join(out, '脚本', 'b001.json'), 'utf8'));
  assert.equal('wav' in script.lines[0], false);
  assert.match(await readFile(res.report, 'utf8'), /没有找到 voice\/full\.wav/);
  await assert.rejects(async () => ex.exportToFactory(job, await loadBoard(job), { outDir: path.join(tmp, 'o3'), variants: 0, ffmpeg: fakeFfmpeg }), /变体数量/);
  await assert.rejects(async () => ex.exportToFactory(job, await loadBoard(job), { outDir: path.join(tmp, 'o4'), music: ['/nope/missing.mp3'], ffmpeg: fakeFfmpeg }), /配乐/);
  const empty = await makeJob({ shots: [gen('S01', 0, 5, 'Hello there', 'clips/missing.mp4')] });
  await assert.rejects(async () => ex.exportToFactory(empty, await loadBoard(empty), { outDir: path.join(tmp, 'o5'), ffmpeg: fakeFfmpeg }), /没有可导出的镜头/);
});

test('exportJob only accepts a folder name inside the export root', async () => {
  const job = await makeJob({ shots: [gen('S01', 0, 5, 'Hello there', 'clips/a.mp4')] });
  for (const bad of ['../escape', 'a/b', 'C:\\x', '']) await assert.rejects(() => api.exportJob(job, { name: bad || ' ' }), /目录名/);
  await assert.rejects(() => api.exportJob(job, { name: 'fine', music: Array(6).fill('/m.mp3') }), /配乐最多/);
});

test('captionSafe breaks up long unpunctuated sentences (the factory hangs on them) and leaves short text alone', () => {
  assert.equal(ex.captionSafe('Short line here'), 'Short line here');
  assert.equal(ex.captionSafe('为什么你总是瘦不下来，试试这个'), '为什么你总是瘦不下来，试试这个');
  const long = "When I saw the scale didn't move, I realized maybe the cardio, cutting carbs, and the diet hacks I used in my twenties weren't working anymore and that was that";
  const safe = ex.captionSafe(long);
  for (const piece of safe.split(/[,，。]/).map(x => x.trim()).filter(Boolean)) assert.ok(piece.length <= 3 * ex.CAPTION_CHARS, `piece too long: ${piece}`);
  const longFree = 'And for women over a certain age it basically switches off so no wonder nothing is working at all for any of them really';
  const out = ex.captionSafe(longFree);
  assert.ok(out.split(', ').every(p => p.length <= 27 || !p.includes(' ')));
  assert.equal(out.replace(/, /g, ' '), longFree, 'only commas are added, no words change');
  const zh = '这是一句没有任何标点符号但是非常非常长的中文句子它会让剪辑端的切分算法卡住所以需要在这里提前切开才行否则渲染会一直卡住';
  const zhSafe = ex.captionSafe(zh);
  assert.ok(zhSafe.split('，').every(p => p.length <= 2 * ex.CAPTION_CHARS));
  assert.equal(zhSafe.replace(/，/g, ''), zh);
  assert.equal(ex.captionSafe(''), '');
});
