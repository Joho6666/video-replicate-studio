import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createEvidenceCapture,createEvidenceHandler,evidenceTimes} from '../src/research-evidence.mjs';
import {MEDIA_LIMITS} from '../src/research-media.mjs';
const jobId='job_synthetic',recordId='record_synthetic',key=createHash('sha256').update(jobId+'\0'+recordId).digest('hex');
const request=asset=>new Request('http://localhost/api/derek-video-replicate/research/evidence?'+new URLSearchParams({jobId,recordId,asset}));
async function setup(t){const root=await mkdtemp(path.join(os.tmpdir(),'evidence-test-'));t.after(()=>rm(root,{recursive:true,force:true}));const directory=path.join(root,'research-analysis',key),cache=path.join(root,'research-media-cache','media-'+key);await mkdir(directory,{recursive:true});await mkdir(cache,{recursive:true});await writeFile(path.join(cache,'cache.json'),JSON.stringify({owner:'dsh-research-v1',createdAt:1000}));return{root,directory,cache,filePath:path.join(cache,'source.mp4')};}
test('frame sampling bounded to twelve and sourced from candidate shot intervals',()=>{assert.deepEqual(evidenceTimes({durationSec:10,candidateCutsSec:[2,4]}),[1,3,7]);assert.equal(evidenceTimes({durationSec:50,candidateCutsSec:Array.from({length:49},(_,i)=>i+1)}).length,12);assert.throws(()=>evidenceTimes({durationSec:Infinity}));});
test('real synthetic frames, retained evidence, ranged playback and hidden gate',async t=>{
 const paths=await setup(t),run=promisify(execFile);await run('/opt/homebrew/bin/ffmpeg',['-hide_banner','-v','error','-f','lavfi','-i','testsrc2=size=96x64:rate=10:duration=1','-an','-c:v','libx264',paths.filePath]);
 const captured=await createEvidenceCapture({root:paths.root})({...paths,jobId,recordId,measurements:{durationSec:1,candidateCutsSec:[.5]}});
 assert.equal(captured.frames.length,2);assert.equal(captured.status,'available');assert(!JSON.stringify(captured).includes(paths.root));
 let hidden=false;const research={getJob:async()=>{if(hidden)throw Object.assign(Error('hidden'),{status:409});return{selectedRecordIds:[recordId]};}};
 const read=createEvidenceHandler({root:paths.root,research,now:()=>1001});
 const frame=await read(request('frame-00.jpg'));assert.equal(frame.status,200);assert.equal(frame.headers.get('content-type'),'image/jpeg');assert((await frame.arrayBuffer()).byteLength>100);
 const videoReq=new Request(request('video'),{headers:{range:'bytes=0-15'}}),video=await read(videoReq);assert.equal(video.status,206);assert.equal((await video.arrayBuffer()).byteLength,16);
 assert.equal((await read(new Request(request('video'),{headers:{range:'bytes=999999999999-'}}))).status,416);
 assert.equal((await read(request('frame-99.jpg'))).status,404);
 hidden=true;assert.equal((await read(request('frame-00.jpg'))).status,409);assert.equal((await read(videoReq)).status,409);
 hidden=false;const expired=createEvidenceHandler({root:paths.root,research,now:()=>1001+MEDIA_LIMITS.ttlMs});assert.equal((await expired(request('video'))).status,410);assert.equal((await expired(request('frame-00.jpg'))).status,200);
 assert.equal((await read(new Request(request('video'),{headers:{origin:'https://external.example'}}))).status,403);
 assert.equal((await read(new Request(request('frame-00.jpg'),{headers:{'sec-fetch-site':'cross-site'}}))).status,403);
});
test('path injection, cache symlink and a frame not in manifest are refused',async t=>{
 const p=await setup(t);await writeFile(p.filePath,'12345678');const research={getJob:async()=>({selectedRecordIds:[recordId]})};const read=createEvidenceHandler({root:p.root,research,now:()=>1001});
 assert.equal((await read(request('../cache.json'))).status,404);
 await rm(p.filePath);const outside=path.join(p.root,'secret.txt');await writeFile(outside,'private');await symlink(outside,p.filePath);assert.equal((await read(request('video'))).status,404);
 const frames=path.join(p.directory,'evidence');await mkdir(frames);await writeFile(path.join(frames,'frame-00.jpg'),'notregistered');await writeFile(path.join(frames,'manifest.json'),JSON.stringify({jobId,recordId,frames:[]}));assert.equal((await read(request('frame-00.jpg'))).status,404);
});

test('stream cancellation releases media and errors never reuse video response headers',async t=>{
 const p=await setup(t);await writeFile(p.filePath,Buffer.alloc(256*1024,7));const read=createEvidenceHandler({root:p.root,research:{getJob:async()=>({selectedRecordIds:[recordId]})},now:()=>1001});
 const res=await read(request('video')),reader=res.body.getReader();const chunk=await reader.read();assert(chunk.value.byteLength<=65536);await reader.cancel();assert.equal((await reader.read()).done,true);
 const invalid=await read(new Request(request('video'),{headers:{range:'bytes=1-0'}}));assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-length'),null);assert.equal(invalid.headers.get('content-range'),null);assert.match(invalid.headers.get('content-type'),/application\/json/);assert((await invalid.json()).error);
});
