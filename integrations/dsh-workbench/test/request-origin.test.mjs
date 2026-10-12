import test from 'node:test';import assert from 'node:assert/strict';
import {sameOrigin} from '../src/request-origin.mjs';
import {createModelSettingsHandlers} from '../src/model-settings.mjs';
import {mkdtemp} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
test('same-origin validation supports the actual DSH internal URL while rejecting crossed hosts',()=>{
 const r=(origin,host='127.0.0.1:43129')=>new Request('http://dsh.internal/api/test',{headers:{origin,host}});
 assert(sameOrigin(r('http://127.0.0.1:43129')));assert(!sameOrigin(r('https://evil.example')));assert(!sameOrigin(r('http://127.0.0.1:9999')));assert(!sameOrigin(r('http://evil.example','evil.example')));assert(!sameOrigin(r('http://127.0.0.1:43129','evil@127.0.0.1:43129')));assert(!sameOrigin(r('http://127.0.0.1:43129','127.0.0.1:43129/other')));
});
test('model drafts save through the DSH Request shape without calling a provider',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'dsh-host-config-'));const h=createModelSettingsHandlers({root,keychain:{has:async()=>false,set:async()=>{throw Error('Unexpected key write')}}});
 const res=await h.save(new Request('http://dsh.internal/api/derek-video-replicate/models',{method:'POST',headers:{host:'127.0.0.1:43129',origin:'http://127.0.0.1:43129','content-type':'application/json','x-derek-workbench':'1','sec-fetch-site':'same-origin'},body:JSON.stringify({id:'seedance-draft',provider:'seedance',displayName:'Seedance',endpoint:'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',modelId:'',purpose:'generation',adapter:'seedance-task-api'})}));assert.equal(res.status,200);assert.equal((await res.json()).model.status,'unverified');
});
