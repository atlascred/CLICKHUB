import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reorderLeadStages, StageOrderConflict } from '../src/modules/leads/services/stage-order.service';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
function fixture(failId?: string) {
 let rows=ids.map((id,index)=>({id,order:index*10,name:'Etapa '+index,status:index===2?'WON':'NEW',active:true,deletedAt:null}));
 let transactions=0;let writes=0;
 const db:any={$transaction:async(callback:any,options:any)=>{
  transactions++;assert.equal(options.isolationLevel,'Serializable');
  const draft=structuredClone(rows);
  const tx={leadKanbanStage:{findMany:async(q:any)=>q.select?draft.map(r=>({id:r.id})):draft.sort((a,b)=>a.order-b.order),update:async(q:any)=>{writes++;if(q.where.id===failId)throw Error('simulated failure');const row=draft.find(r=>r.id===q.where.id)!;Object.assign(row,q.data);return row;}}};
  const result=await callback(tx);rows=draft;return result;
 }};
 return{db,rows:()=>rows,stats:()=>({transactions,writes})};
}
test('ordem salva usa todas as categorias e altera somente a posição',async()=>{
 const f=fixture();const original=structuredClone(f.rows());
 const ordered=await reorderLeadStages({ids:[ids[2],ids[0],ids[1]]},f.db);
 assert.deepEqual(ordered.map(s=>s.id),[ids[2],ids[0],ids[1]]);
 assert.deepEqual(ordered.map(s=>s.order),[10,20,30]);
 for(const row of f.rows()){const before=original.find(r=>r.id===row.id)!;assert.equal(row.name,before.name);assert.equal(row.status,before.status);}
});
test('listas repetidas, incompletas ou com categorias desconhecidas não são gravadas',async()=>{
 const f=fixture();
 await assert.rejects(reorderLeadStages({ids:[ids[0],ids[0],ids[1]]},f.db));assert.equal(f.stats().transactions,0);
 await assert.rejects(reorderLeadStages({ids:[ids[0],ids[1]]},f.db),StageOrderConflict);
 await assert.rejects(reorderLeadStages({ids:[ids[0],ids[1],'44444444-4444-4444-8444-444444444444']},f.db),StageOrderConflict);
 assert.equal(f.stats().writes,0);
});
test('falha no meio da organização desfaz toda a sequência',async()=>{
 const f=fixture(ids[1]);const before=structuredClone(f.rows());
 await assert.rejects(reorderLeadStages({ids:[ids[2],ids[1],ids[0]]},f.db),/simulated failure/);
 assert.deepEqual(f.rows(),before);
});
