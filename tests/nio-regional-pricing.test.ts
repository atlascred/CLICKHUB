import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nioCityTier,nioBtuCities,nioRegionalPlans,nioNormalPlans} from '../src/modules/chatbot/nio-regional-pricing';
test('lista BTU da imagem tem 125 combinações de cidade e UF sem repetições',()=>{
 const pairs=Object.entries(nioBtuCities).flatMap(([uf,names])=>names.map(city=>uf+':'+city));assert.equal(pairs.length,125);assert.equal(new Set(pairs).size,125);
 for(const [uf,names]of Object.entries(nioBtuCities))for(const name of names)assert.equal(nioCityTier(name,uf),'btu');
});
test('cidade e UF impedem promoção em homônimos ou localização desconhecida',()=>{
 assert.equal(nioCityTier('  sao jose  ','sc'),'btu');assert.equal(nioCityTier('São José','SP'),'normal');
 assert.equal(nioCityTier('Palmas','PR'),'btu');assert.equal(nioCityTier('Palmas','TO'),'normal');
 assert.equal(nioCityTier('São Paulo','SP'),'normal');assert.equal(nioCityTier('Campinas','SP'),'btu');
 assert.equal(nioCityTier('Itabaiana','PB'),'normal');assert.equal(nioCityTier('Itabaiana','SE'),'btu');
 assert.equal(nioCityTier('', 'SP'),null);assert.equal(nioCityTier('Campinas','ZZ'),null);
});
test('política aplicada exclusivamente a CLICK sem alterar catálogo VIVO',()=>{
 const plans=[{id:'special'},{id:'normal'}],rules={nioRegionalPricing:{version:1,btuPlanIds:['special'],normalPlanIds:['normal']}};
 assert.deepEqual(nioRegionalPlans({zapiInstanceId:'CLICK',rules},{city:'Campinas',state:'SP'},plans),[{id:'special'}]);
 assert.deepEqual(nioRegionalPlans({zapiInstanceId:'CLICK',rules},{city:'São Paulo',state:'SP'},plans),[{id:'normal'}]);
 assert.deepEqual(nioRegionalPlans({zapiInstanceId:'CLICK',rules},{},plans),[]);
 assert.equal(nioRegionalPlans({zapiInstanceId:'GIGA CLICK',rules},{city:'Campinas',state:'SP'},plans),plans);
 assert.deepEqual(nioNormalPlans.map(p=>p.price),[110,140,170,200]);
});
