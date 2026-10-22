import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalise, matchPack, readManifest, auditPack, runImport } from '../scripts/media/import-pack.mjs';

const tinyPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kyvo-pack-test-'));
  const source = path.join(dir,'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source,'demo.png'),tinyPng);
  const exercises = [{id:'barbell-bench-press',name:'Barbell bench press',aliases:['flat barbell bench']},{id:'goblet-squat',name:'Goblet squat',aliases:[]}];
  const catalogue = path.join(dir,'exercises.json'); fs.writeFileSync(catalogue,JSON.stringify(exercises));
  const manifest=path.join(dir,'manifest.json');fs.writeFileSync(manifest,JSON.stringify([{name:'Barbell Bench Press',file:'demo.png'}]));
  try {return fn({dir,source,exercises,catalogue,manifest,out:path.join(dir,'public'),report:path.join(dir,'report.json')});}
  finally {fs.rmSync(dir,{recursive:true,force:true});}
}
test('legacy matcher remains usable by Everkinetic',()=>{
  const result=matchPack([{id:'a',name:'Dumbbell curls',aliases:[],equipment:['dumbbell']}],[{name:'Dumbbell curl',media:'a'}]);
  assert.equal(result.matched.length,1);
  assert.equal(normalise('Dumbbell curls'),normalise('Dumbbell curl'));
});
test('CSV reader supports quoted commas and newlines',()=>fixture(({dir})=>{
  const p=path.join(dir,'a.csv');fs.writeFileSync(p,'name,file\n"Press, incline",demo.png\n');
  assert.equal(readManifest(p)[0].name,'Press, incline');
}));
test('audit finds exact match and missing exercise without modifying assets',()=>fixture(({source,exercises,manifest})=>{
  const audit=auditPack(exercises,readManifest(manifest),{},source);
  assert.equal(audit.matched.length,1);assert.deepEqual(audit.missing,['goblet-squat']);
}));
test('similar but non-identical names never auto-import',()=>fixture(({source,exercises})=>{
  const audit=auditPack(exercises,[{name:'Bench press',media:'demo.png'}],{},source);
  assert.equal(audit.matched.length,0);
}));
test('duplicate vendor rows are ambiguous',()=>fixture(({source,exercises})=>{
  const audit=auditPack(exercises,[{name:'Barbell bench press',media:'demo.png'},{name:'Barbell bench press',media:'demo.png'}],{},source);
  assert.equal(audit.matched.length,0);assert.ok(audit.review.some(x=>x.id==='barbell-bench-press'));
}));
test('rejects path traversal, symlinks and mismatched extension signature',()=>fixture(({source,exercises,dir})=>{
  fs.writeFileSync(path.join(source,'not.png'),'not a real png');
  fs.symlinkSync(path.join(dir,'outside.png'),path.join(source,'linked.png'));
  fs.writeFileSync(path.join(dir,'outside.png'),tinyPng);
  for(const media of ['../outside.png','linked.png','not.png']){
    const a=auditPack(exercises,[{name:'Barbell bench press',media}],{},source);
    assert.equal(a.matched.length,0);assert.equal(a.noFile.length,1);
  }
}));
test('audit is default and apply preserves exact existing output until publishing',()=>fixture(({source,catalogue,manifest,out,report})=>{
  fs.mkdirSync(path.join(out,'media','pack'),{recursive:true});
  fs.writeFileSync(path.join(out,'media','pack','old.txt'),'keep');
  const opts={manifest,dir:source,vendor:'Test Vendor',license:'Commercial demo - verify independently',out,report,exercisesFile:catalogue};
  const a=runImport(opts);
  assert.equal(a.importable,1);
  assert.ok(fs.existsSync(path.join(out,'media','pack','old.txt')));
  runImport({...opts,apply:true});
  assert.ok(fs.existsSync(path.join(out,'media','pack','barbell-bench-press.png')));
  assert.ok(!fs.existsSync(path.join(out,'media','pack','old.txt')));
  const index=JSON.parse(fs.readFileSync(path.join(out,'data','media-pack.json'),'utf8'));
  assert.equal(index.exercises['barbell-bench-press'].still,true);
}));
test('manual override is exact and does not hide missing vendor row',()=>fixture(({source,exercises})=>{
  const audit=auditPack(exercises,[{name:'Incline barbell press',media:'demo.png'}],{'barbell-bench-press':'Invalid name'},source);
  assert.equal(audit.matched.length,0);assert.equal(audit.review[0].reason,'Manual mapping target not found');
}));

test('apply refuses to replace existing pack when there are zero matches',()=>fixture(({source,catalogue,out,report,dir})=>{
  fs.mkdirSync(path.join(out,'media','pack'),{recursive:true});
  fs.writeFileSync(path.join(out,'media','pack','old.txt'),'original');
  const manifest=path.join(dir,'none.json');
  fs.writeFileSync(manifest,JSON.stringify([{name:'Other exercise',file:'demo.png'}]));
  assert.throws(()=>runImport({manifest,dir:source,vendor:'Test',license:'Commercial',out,report,exercisesFile:catalogue,apply:true}),/No validated matches/);
  assert.equal(fs.readFileSync(path.join(out,'media','pack','old.txt'),'utf8'),'original');
}));