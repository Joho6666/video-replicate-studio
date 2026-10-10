// DSH's HTTP bridge keeps the real Host header but constructs Request URLs
// under http://dsh.internal. This local-only plugin compares Origin to that
// preserved loopback authority, never to an arbitrary forwarded host.
export function sameOrigin(request) {
 const origin=request.headers.get('origin');if(!origin)return true;
 const url=new URL(request.url);if(url.hostname!=='dsh.internal')return origin===url.origin;
 try{const host=request.headers.get('host');if(!host)return false;const actual=new URL('http://'+host);
  if(!['127.0.0.1','localhost','[::1]'].includes(actual.hostname)||actual.username||actual.password||actual.pathname!=='/'||actual.search||actual.hash)return false;
  return origin===actual.origin;
 }catch{return false;}
}
