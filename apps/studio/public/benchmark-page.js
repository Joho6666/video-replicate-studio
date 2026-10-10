import {mountAccountBenchmark} from './account-ui.js';
mountAccountBenchmark(document.querySelector('#benchmark'),{
  storageKey:'studio-account-benchmark:v1',
  async loadSamples(url){
    const response=await fetch('/api/benchmark/samples',{method:'POST',headers:{'content-type':'application/json','x-studio':'1'},body:JSON.stringify({url,consent:true})});
    const body=await response.json();if(!response.ok)throw new Error(body.error||'账号读取失败');return body;
  }
});
