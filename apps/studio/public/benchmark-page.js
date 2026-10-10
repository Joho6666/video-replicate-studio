import {mountAccountBenchmark} from './account-ui.js';
import {parseInstagram} from './account-core.js';
import {benchmarkRequest} from './benchmark-api.js';
mountAccountBenchmark(document.querySelector('#benchmark'),{
  storageKey:'studio-account-benchmark:v1',
  loadSamples:(url,{refresh=false}={})=>benchmarkRequest('/samples',{url,refresh,consent:refresh}),
  importLegacy:state=>benchmarkRequest('/history/import-legacy',state),
  async loadPreproduction(url){
    const account=parseInstagram(url);
    if(account?.kind!=='account')throw new Error('需要 Instagram 品牌主页。');
    const report=await benchmarkRequest('/preproduction/report?'+new URLSearchParams({username:account.username}));
    return {...report,evidenceBase:'/api/benchmark/preproduction/evidence'};
  },
  saveStyle:(runId,styleId)=>benchmarkRequest('/preproduction/style',{runId,styleId})
});
