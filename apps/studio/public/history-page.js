import {mountHistoryLibrary} from './history-ui.js';
import {benchmarkRequest,importLegacyAccounts} from './benchmark-api.js';

mountHistoryLibrary(document.querySelector('#history'),{
  load:({view='active',q=''}={})=>benchmarkRequest('/history?'+new URLSearchParams({view,q})),
  mutate:body=>benchmarkRequest('/history',body),
  async loadReport(record,ref){
    const params=new URLSearchParams({run:ref.runId,username:record.account.username});
    if(record.hidden&&!record.trashedAt)params.set('includeHidden','1');
    const report=await benchmarkRequest('/preproduction/report?'+params);
    return {...report,evidenceBase:'/api/benchmark/preproduction/evidence'};
  },
  saveStyle:(runId,styleId)=>benchmarkRequest('/preproduction/style',{runId,styleId}),
  loadReview:id=>benchmarkRequest('/history/review?'+new URLSearchParams({id})),
  loadImportedReport:id=>benchmarkRequest('/history/imported-report?'+new URLSearchParams({id})),
  importLegacy:importLegacyAccounts
});
