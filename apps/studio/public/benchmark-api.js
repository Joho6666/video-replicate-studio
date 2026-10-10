const BASE='/api/benchmark';
export async function benchmarkRequest(path,body){
  const response=await fetch(BASE+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'content-type':'application/json','x-studio':'1'},body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'本机资料读取失败');
  return result;
}
// Only the two account-page keys belong to this feature. No global storage scan.
export async function importLegacyAccounts(){
  const results=[];
  for(const key of ['studio-account-benchmark:v1','studio-account-benchmark:v1:previous']){
    let value;try{value=JSON.parse(localStorage.getItem(key)||'null');}catch{continue;}
    if(value?.account)results.push(await benchmarkRequest('/history/import-legacy',value));
  }
  return {imported:results.length,results};
}
