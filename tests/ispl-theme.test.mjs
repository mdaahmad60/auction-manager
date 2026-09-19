import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function fixture() {
  class Element {
    constructor(){this.children=[];this.dataset={};this.hidden=false;this.textContent='';}
    appendChild(node){this.children.push(node);}
    append(...nodes){this.children.push(...nodes);}
    prepend(node){this.children.unshift(node);}
    replaceChildren(...nodes){this.children=nodes;}
    setAttribute(){}
    removeAttribute(){}
  }
  const nodes=new Map(), timers=new Map();let timerId=0;
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const context=vm.createContext({document:{getElementById:get,createElement:()=>new Element()},
    setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
    setInterval:fn=>{timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id)});
  for(const file of ['mmm','ispl'])vm.runInContext(readFileSync(new URL(`../themes/${file}.js`,import.meta.url),'utf8'),context);
  const send=data=>{context.data=data;vm.runInContext('receiveMMM(data)',context);};
  const text=node=>[node.textContent,...node.children.map(text)].join(' ');
  return {send,get,context,timers,text:()=>text(get('ispl-overlay'))};
}
const player={name:'Test Player',role:'Batter',category:'East Zone',phase:'intro'};
const sync=(extra={})=>({type:'SYNC_ALL',settings:{theme:'ispl',showBidding:true},currentPlayer:player,base:300000,bid:320000,...extra});
test('ISPL follows intro, bidding, results and result timeout',()=>{
  const f=fixture(); f.send(sync());
  assert.equal(f.get('display-app').dataset.theme,'ispl');
  assert.match(f.text(),/East Zone/);assert.match(f.text(),/₹ 3L/);
  f.send({type:'BID_UPDATE',player:{...player,phase:'bidding'},base:300000,bid:320000});
  assert.match(f.text(),/CURRENT BID/);assert.match(f.text(),/3.2L/);
  f.send({type:'SOLD_CELEBRATION',playerDetails:player,team:'Lions',bid:320000});
  f.send(sync({currentPlayer:null}));
  assert.match(f.text(),/SOLD/);assert.match(f.text(),/Lions/);
  [...f.timers.values()][0]();assert.equal(f.get('ispl-overlay').hidden,true);
  f.send({type:'UNSOLD_ANIMATION',playerDetails:player});assert.match(f.text(),/UNSOLD/);
  f.send({type:'BID_UPDATE',player:{...player,name:'Next Player'},base:100,bid:100});
  assert.doesNotMatch(f.text(),/UNSOLD/);assert.match(f.text(),/Next Player/);
});
test('ISPL panels page real purses and squad counts and stop on theme switch',()=>{
  const f=fixture();const teams=Array.from({length:9},(_,i)=>({name:`Team ${i}`,purse:2150000,playerList:[{},{}]}));
  f.send(sync({teams,settings:{theme:'ispl',isplView:'purse'}}));
  assert.match(f.text(),/21.50/);assert.doesNotMatch(f.text(),/Team 8/);
  [...f.timers.values()][0]();assert.match(f.text(),/Team 8/);assert.doesNotMatch(f.text(),/Team 0/);
  f.send(sync({teams,settings:{theme:'ispl',isplView:'squad'}}));
  assert.match(f.text(),/SQUAD SIZE/);assert.match(f.text(),/Team 0 2/);
  f.send(sync({settings:{theme:'classic'}}));assert.equal(f.get('ispl-overlay').hidden,true);assert.equal(f.timers.size,0);
});
test('ISPL identical snapshots preserve mounted graphics and animation progress',()=>{
  const f=fixture();f.send(sync());
  const card=f.get('ispl-overlay').children[0];
  f.send(sync());
  assert.equal(f.get('ispl-overlay').children[0],card);
});
test('ISPL animation helper respects reduced motion',()=>{
  const f=fixture();let calls=0;
  f.context.node={animate:()=>calls++};
  f.context.matchMedia=()=>({matches:true});
  vm.runInContext('animateISPL(node, [{opacity:0},{opacity:1}])',f.context);
  assert.equal(calls,0);
  f.context.matchMedia=()=>({matches:false});
  vm.runInContext('animateISPL(node, [{opacity:0},{opacity:1}])',f.context);
  assert.equal(calls,1);
});
function ghostFixture() {
  const f=fixture();
  f.context.matchMedia=()=>({matches:false});
  const appended=[];
  const root={getBoundingClientRect:()=>({left:0,top:0}),appendChild:node=>appended.push(node)};
  const removed=[];
  const clone={style:{},remove:()=>removed.push(clone)};
  clone.animate=(frames,options)=>{clone.frames=frames;clone.options=options;clone.animation={onfinish:null};return clone.animation;};
  const found={cloneNode:()=>clone,getBoundingClientRect:()=>({left:100,top:200,width:82,height:82})};
  const previousCard={querySelector:sel=>sel==='.ispl-gavel'?found:null};
  Object.assign(f.context,{root,previousCard});
  return {...f,appended,removed,clone};
}
test('ISPL gavel ghost is captured before the rebuild, then released (positioned + animated) after, and self-removes',()=>{
  const f=ghostFixture();
  vm.runInContext("globalThis.ghost = isplCaptureGhost(root, previousCard, '.ispl-gavel')",f.context);
  assert.equal(f.appended.length,0,'capture must not touch the DOM yet — the caller still needs to replaceChildren() first');
  vm.runInContext("isplReleaseGhost(root, ghost, [{translate:'0 0',opacity:1},{translate:'-60px 0',opacity:0}])",f.context);
  assert.equal(f.appended[0],f.clone,'release must append the clone to the (now-rebuilt) root');
  assert.match(f.clone.style.cssText,/left:100px/);assert.match(f.clone.style.cssText,/top:200px/);
  assert.equal(f.clone.frames[1].translate,'-60px 0');
  assert.equal(f.removed.length,0,'must not be removed before its exit animation finishes');
  f.clone.animation.onfinish();
  assert.equal(f.removed[0],f.clone);
});
test('ISPL gavel ghost capture is a no-op with no matching element or under reduced motion',()=>{
  const empty=ghostFixture();
  vm.runInContext("globalThis.ghost = isplCaptureGhost(root, {querySelector:()=>null}, '.ispl-gavel')",empty.context);
  assert.equal(vm.runInContext('ghost',empty.context),null);
  const reduced=ghostFixture();
  reduced.context.matchMedia=()=>({matches:true});
  vm.runInContext("globalThis.ghost = isplCaptureGhost(root, previousCard, '.ispl-gavel')",reduced.context);
  assert.equal(vm.runInContext('ghost',reduced.context),null);
});
test('ISPL disappearance is a quick, snappy exit and a new player cancels stale cleanup',()=>{
  const f=fixture();f.send(sync());
  const root=f.get('ispl-overlay');
  Object.defineProperty(root,'firstElementChild',{get:()=>root.children[0]});
  let duration;let cancelled=false;
  const animation={cancel(){cancelled=true;}};
  root.children[0].animate=(_,options)=>{duration=options.duration;return animation;};
  f.send(sync({currentPlayer:null}));
  const exitDuration=vm.runInContext('ISPL_EXIT_MS',f.context);
  assert.equal(duration,exitDuration);
  assert.ok(exitDuration<1000,'exit should be snappy, not the old 2.5s crawl');
  assert.equal(root.hidden,false);
  f.send(sync({currentPlayer:{...player,name:'Next'}}));
  assert.equal(cancelled,true);assert.equal(animation.onfinish,null);
  assert.equal(root.hidden,false);assert.match(f.text(),/Next/);
  root.children[0].animate=()=>animation;
  f.send(sync({currentPlayer:null}));animation.onfinish();
  assert.equal(root.hidden,true);assert.equal(root.children.length,0);
});
test('ISPL entrance, bidding and sold transitions use short, purpose-tuned durations',()=>{
  const f=fixture();const durations=[];
  f.context.root={append(){}};
  const content={animate:(_,options)=>durations.push(options.duration)};
  content.querySelector=()=>content;
  f.context.content=content;
  for(const phase of ['intro','bidding','sold']) {
    f.context.frame={mode:'player',player:'same',phase,bid:100};
    vm.runInContext('mountISPL(root,content,frame)',f.context);
  }
  const named=['ISPL_ENTER_MS','ISPL_SHIFT_MS','ISPL_REVEAL_MS','ISPL_POP_MS'].map(name=>vm.runInContext(name,f.context));
  assert.ok(durations.length>3);
  assert.ok(durations.every(duration=>named.includes(duration)),'every requested duration should be one of the named ISPL timing constants');
  assert.ok(durations.every(duration=>duration<1000),'transitions should be snappy, not the old 2.5s crawl');
  assert.ok(new Set(durations).size>1,'structural moves and the sold-result pop should use different, purpose-tuned durations');
});
