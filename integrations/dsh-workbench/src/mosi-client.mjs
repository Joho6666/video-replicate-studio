import {spawn} from 'node:child_process';
import {openAsBlob} from 'node:fs';
import {stat} from 'node:fs/promises';
import {validateMediaUrl} from './research-media.mjs';

export const MOSI_BASE_URL='https://api.mosi.cn/v1';
export const MOSI_VISION_MODEL='moss-vl-1.0';
export const MOSI_AUDIO_MODEL='moss-transcribe-diarize-pro';
export const MOSI_KEYCHAIN_SERVICE='derek.dsh-workbenches.models.mosi';
const MAX_RESPONSE_BYTES=2*1024*1024;
const MESSAGES={
 MOSI_KEY_MISSING:'尚未配置模思 API Key。',MOSI_KEYCHAIN:'macOS Keychain 暂不可用。',
 MOSI_NETWORK:'模思请求未获得可确认的响应；为避免重复计费，未自动重试。',MOSI_REDIRECT:'模思返回重定向，已停止请求以保护密钥。',
 MOSI_AUTH:'模思鉴权失败，请检查服务器端密钥。',MOSI_LIMIT:'模思额度或请求频率受限。',MOSI_REMOTE:'模思未完成请求；原有本机报告仍保留。',
 MOSI_RESPONSE:'模思返回内容无法读取，未自动重试。',MOSI_INPUT:'分析输入不符合模思接口要求。',MOSI_FILE_SIZE:'视频超过 200 MB 或音频超过 512 MB，未上传。',
 MOSI_INCOMPLETE:'模思分析输出不完整，未自动重试。'
};
export function mosiError(code,status=502){return Object.assign(new Error(MESSAGES[code]||MESSAGES.MOSI_REMOTE),{code,safeStatus:status});}
export function safeMosiError(error){const code=Object.hasOwn(MESSAGES,error?.code)?error.code:'MOSI_REMOTE';return {code,message:MESSAGES[code]};}

function keychain(readSecret){return new Promise((resolve,reject)=>{
 const args=['find-generic-password','-a','analysis','-s',MOSI_KEYCHAIN_SERVICE];if(readSecret)args.push('-w');
 const child=spawn('/usr/bin/security',args,{stdio:['ignore','pipe','pipe']});let output='',settled=false;
 const finish=(code)=>{if(settled)return;settled=true;clearTimeout(timer);if(code===44)return readSecret?reject(mosiError('MOSI_KEY_MISSING',503)):resolve(false);if(code!==0)return reject(mosiError('MOSI_KEYCHAIN',503));if(!readSecret)return resolve(true);const value=output.trim();output='';if(!/^[\x21-\x7e]{1,4096}$/.test(value))return reject(mosiError('MOSI_KEY_MISSING',503));resolve(value);};
 const timer=setTimeout(()=>{child.kill();finish(-1);},10000);child.stdout.on('data',chunk=>{if(readSecret){output+=chunk.toString();if(output.length>8192){output='';child.kill();finish(-1);}}});child.stderr.resume();child.on('error',()=>finish(-1));child.on('close',finish);
 });}
export const readMosiKeychain=()=>keychain(true);
export const hasMosiKeychain=()=>keychain(false);

export function normalizeUsage(value){
 const out={};if(!value||typeof value!=='object')return out;
 for(const key of ['input_tokens','output_tokens','total_tokens','duration','duration_seconds','audio_seconds','input_audio_seconds','audio_duration_seconds'])if(Number.isFinite(value[key])&&value[key]>=0)out[key]=value[key];
 return out;
}
async function jsonResponse(response){
 try{const reader=response.body?.getReader();if(!reader)throw Error();let total=0;const chunks=[];try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_RESPONSE_BYTES){await reader.cancel();throw Error();}chunks.push(value);}}finally{reader.releaseLock();}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw mosiError('MOSI_RESPONSE');}
}
export function createMosiClient({transport=globalThis.fetch,keyProvider=readMosiKeychain,keyStatusProvider=hasMosiKeychain,timeoutMs=180000}={}){
 async function request(endpoint,{body,json}={}){
  if(!['/files','/responses','/audio/transcriptions'].includes(endpoint))throw mosiError('MOSI_INPUT',400);
  let secret;try{secret=await keyProvider();}catch(error){throw mosiError(error?.code==='MOSI_KEY_MISSING'?'MOSI_KEY_MISSING':'MOSI_KEYCHAIN',503);}
  if(typeof secret!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(secret))throw mosiError('MOSI_KEY_MISSING',503);
  const headers={authorization:'Bearer '+secret};if(json!==undefined){headers['content-type']='application/json';body=JSON.stringify(json);}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);let response;
  try{response=await transport(MOSI_BASE_URL+endpoint,{method:'POST',headers,body,redirect:'manual',signal:controller.signal});
   // Never follow even same-origin redirects: an upload has already been attempted.
   if(response.redirected||response.status>=300&&response.status<400||response.url&&new URL(response.url).origin!=='https://api.mosi.cn')throw mosiError('MOSI_REDIRECT');
   if(!response.ok){await response.body?.cancel().catch(()=>{});throw mosiError([401,403].includes(response.status)?'MOSI_AUTH':[402,429].includes(response.status)?'MOSI_LIMIT':'MOSI_REMOTE');}
   return await jsonResponse(response);
  }catch(error){throw error?.code&&Object.hasOwn(MESSAGES,error.code)?error:mosiError('MOSI_NETWORK');}
  finally{clearTimeout(timer);secret='';delete headers.authorization;}
 }
 async function localBlob(filePath,type,limit){try{const info=await stat(filePath);if(!info.isFile()||info.size<=0)throw mosiError('MOSI_INPUT',400);if(info.size>limit)throw mosiError('MOSI_FILE_SIZE',413);return await openAsBlob(filePath,{type});}catch(error){throw error?.code==='MOSI_FILE_SIZE'?error:mosiError('MOSI_INPUT',400);}}
 return {
  async configured(){try{return await keyStatusProvider()===true;}catch{return false;}},
  async uploadVideo({filePath}){const form=new FormData();form.append('purpose','video');form.append('file',await localBlob(filePath,'video/mp4',200*1024*1024),'reference.mp4');const data=await request('/files',{body:form});if(typeof data.id!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(data.id)||['failed','error'].includes(data.status))throw mosiError('MOSI_RESPONSE');return {fileId:data.id,status:typeof data.status==='string'?data.status:null};},
  async transcribe({filePath}){const form=new FormData();form.append('model',MOSI_AUDIO_MODEL);form.append('file',await localBlob(filePath,'audio/flac',512*1024*1024),'audio.flac');form.append('diarize','true');form.append('response_format','diarized_json');form.append('stream','false');form.append('async','false');return request('/audio/transcriptions',{body:form});},
  async analyzeVideo({fileId,videoUrl,prompt,maxOutputTokens=2500}){if((fileId!==undefined)===(videoUrl!==undefined)||fileId!==undefined&&(typeof fileId!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(fileId))||typeof prompt!=='string'||!prompt.trim()||!Number.isInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>8192)throw mosiError('MOSI_INPUT',400);let input;if(videoUrl!==undefined){try{input={type:'input_video',video_url:validateMediaUrl(videoUrl)};}catch{throw mosiError('MOSI_INPUT',400);}}else input={type:'input_video',file_id:fileId};return request('/responses',{json:{model:MOSI_VISION_MODEL,input:[{role:'user',content:[{type:'input_text',text:prompt},input]}],max_output_tokens:maxOutputTokens}});}
 };
}
