import {readFile,readdir,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
for(const mode of ['factory','replicate']){
 const dir=path.join(root,'workbenches',mode);const m=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));
 assert(m.name&&/^\d+\.\d+\.\d+$/.test(m.version));assert.equal(m.type,'module');assert.equal(m.dsh.client.platform,'web');assert(m.dsh.client.inject.includes('dsh-desktop-workbenches'));assert.equal(m.dsh.bundle.patch,'./cordis.patch.yml');
 for(const k of ['.','./client','./package.json','./cordis.patch.yml']){assert(m.exports[k]);assert((await stat(path.join(dir,m.exports[k]))).isFile());}
 const patch=await readFile(path.join(dir,'cordis.patch.yml'),'utf8');assert(patch.includes(`name: ${m.name}`));assert(patch.includes('- insert:'));
 const server=await readFile(path.join(dir,m.main),'utf8');assert(server.includes('Schema.object'));assert(server.includes('function apply'));
 const client=await readFile(path.join(dir,m.exports['./client']),'utf8');assert(client.includes('window.__ModuleLoader__.load'));assert(client.includes(m.name));assert(client.includes('customFrame'));assert(client.includes('desktopWorkbenches.register'));assert(!/https:\/\/[^\s"']+\.(jpg|png)/.test(client),'no remote image dependencies');
 execFileSync(process.execPath,['--check',path.join(dir,m.exports['./client'])]);execFileSync(process.execPath,['--check',path.join(dir,m.main)]);
 const files=await readdir(dir);assert(!files.some(x=>/^(\.env|node_modules|data)$/.test(x)));
 console.log(`PASS ${m.name}: manifest, bundle, entries, syntax, data exclusions`);
}
