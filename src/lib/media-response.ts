/** Byte ranges are needed by native audio/video players, including Safari. */
export function mediaResponse(request: Request, bytes: Uint8Array, mimeType: string, fileName: string) {
  const safeName=fileName.replace(/[^\w.\-]+/g,'_').slice(0,120)||'arquivo';
  const safeMime=/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[^\r\n]*)?$/i.test(mimeType)?mimeType:'application/octet-stream';
  const inline=/^(image\/(jpeg|png|webp|gif)|audio\/|video\/|application\/pdf)/i.test(safeMime);
  const headers=new Headers({'Content-Type':safeMime,'Content-Disposition':`${inline?'inline':'attachment'}; filename="${safeName}"`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Accept-Ranges':'bytes'});
  const range=request.headers.get('range');
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    let start=0,end=bytes.byteLength-1;
    if(match){if(!match[1]&&match[2])start=Math.max(0,bytes.byteLength-Number(match[2]));else start=Number(match[1]);if(match[1]&&match[2])end=Math.min(end,Number(match[2]));}
    if(!match||!match[1]&&!match[2]||!match[1]&&Number(match[2])===0||start>end||start>=bytes.byteLength){headers.set('Content-Range',`bytes */${bytes.byteLength}`);return new Response(null,{status:416,headers});}
    headers.set('Content-Range',`bytes ${start}-${end}/${bytes.byteLength}`);headers.set('Content-Length',String(end-start+1));
    return new Response(new Uint8Array(bytes.slice(start,end+1)),{status:206,headers});
  }
  headers.set('Content-Length',String(bytes.byteLength));
  return new Response(new Uint8Array(bytes),{headers});
}
