import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../scripts/auction.js',import.meta.url),'utf8');
const selected=['handleOvLiveSync','handleOvLiveBid','armOvLiveResultTimer','buildSoldLookup'].map(name=>source.match(new RegExp('function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}'))[0]).join('\n');
for (const phase of ['sold','unsold']) test(`new player delta interrupts ${phase} result and retains latest bid`,()=>{
  const timers=new Map();let nextTimer=0;
  const context=vm.createContext({setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(`let ovData=null,ovLiveLastPlayer=null,ovLiveResult=null,ovLiveResultTimer=null;let rendered;
    function renderLiveAuctionPane(data){rendered=ovLiveResult ? ovLiveResult.phase : data.currentPlayer?.name || 'EMPTY';}
    ${selected}`,context);
  const sync=data=>{context.input=data;vm.runInContext('handleOvLiveSync(input)',context);};
  const bid=data=>{context.input=data;vm.runInContext('handleOvLiveBid(input)',context);};
  const initial={currentPlayer:{name:'Alice',serial:1},base:100,bid:200,introFields:[],teams:[],soldSerials:[],unsoldSerials:[]};
  sync(initial);
  sync({...initial,currentPlayer:null,soldSerials:phase==='sold'?[1]:[],unsoldSerials:phase==='unsold'?[1]:[]});
  assert.equal(vm.runInContext('rendered',context),phase);
  bid({player:null,base:100,bid:100});
  assert.equal(timers.size,1,'empty background update should preserve the result');
  bid({player:{name:'Bob',serial:2},base:300,bid:400});
  assert.equal(vm.runInContext('rendered',context),'Bob');
  assert.equal(timers.size,0,'old result timer must be cancelled');
  assert.equal(vm.runInContext('ovData.currentPlayer.name',context),'Bob');
  assert.equal(vm.runInContext('ovData.bid',context),400);
});
