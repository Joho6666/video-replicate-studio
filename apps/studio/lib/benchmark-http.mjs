// Adapter for shared Web Request handlers, kept separate from Studio env/API clients.
export async function toWebRequest(req, {limit=1_000_000}={}) {
  const headers=new Headers();
  for(const [name,value] of Object.entries(req.headers||{})) if(value!==undefined) headers.set(name,Array.isArray(value)?value.join(', '):String(value));
  if(headers.get('x-studio')==='1') headers.set('x-derek-workbench','1');
  const chunks=[];let size=0;
  if(req.method!=='GET'&&req.method!=='HEAD')for await(const chunk of req){const buffer=Buffer.from(chunk);size+=buffer.length;if(size>limit)throw Object.assign(new Error('请求过大'),{status:413});chunks.push(buffer);}
  const authority=headers.get('host')||'127.0.0.1';
  const url=new URL(req.url,`http://${authority}`);
  return new Request(url,{method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
}
export async function sendWebResponse(res,response){
  const headers=Object.fromEntries(response.headers);
  res.writeHead(response.status,headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}
