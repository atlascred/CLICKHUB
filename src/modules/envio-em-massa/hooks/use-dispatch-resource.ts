"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/client-api";
export function useDispatchResource<T>(url: string, enabled = true) {
  const [resource, setResource] = useState<{url:string;data:T|null;loading:boolean;error:string|null}>({url,data:null,loading:enabled,error:null});
  const sequence = useRef(0), current = useRef(url), controller = useRef<AbortController|null>(null); current.current = url;
  const refresh = useCallback(async()=>{
    if (!enabled) return;
    const turn = ++sequence.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setResource(previous=>({url,data:previous.url===url?previous.data:null,loading:previous.url!==url||!previous.data,error:null}));
    try { const response = await fetchApi(url,{cache:"no-store",signal:abort.signal}); const payload=await response.json(); if(!response.ok||payload.status!=="success")throw new Error(payload.message||"Não foi possível carregar os dados."); if(current.current===url&&sequence.current===turn)setResource({url,data:payload.data,loading:false,error:null}); }
    catch(error) { if(!abort.signal.aborted&&current.current===url&&sequence.current===turn)setResource(previous=>({...previous,loading:false,error:error instanceof Error?error.message:"Falha de conexão."})); }
  },[url,enabled]);
  useEffect(()=>{void refresh();return()=>{sequence.current++;controller.current?.abort();};},[refresh]);
  return {data:resource.url===url?resource.data:null,loading:enabled&&(resource.url!==url||resource.loading),error:resource.url===url?resource.error:null,refresh};
}
export function useDispatchPolling(refresh:()=>Promise<unknown>) {
  const latest=useRef(refresh);latest.current=refresh;
  useEffect(()=>{let busy=false;const update=async()=>{if(busy||document.hidden)return;busy=true;try{await latest.current();}finally{busy=false;}};const timer=setInterval(()=>void update(),5000);const visible=()=>{if(!document.hidden)void update();};document.addEventListener("visibilitychange",visible);window.addEventListener("focus",visible);return()=>{clearInterval(timer);document.removeEventListener("visibilitychange",visible);window.removeEventListener("focus",visible);};},[]);
}
