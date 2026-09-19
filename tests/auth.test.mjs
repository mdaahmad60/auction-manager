import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../scripts/auth.js',import.meta.url),'utf8');
function harness(auth={}) {
  const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',dataset:{}});return nodes.get(id);};
  const context=vm.createContext({console,URL,URLSearchParams,setTimeout,clearTimeout,location:{origin:'https://auction.example',pathname:'/',search:''},history:{replaceState(){}},window:{APP_CONFIG:{},addEventListener(){}},document:{getElementById:node,addEventListener(){}}});
  vm.runInContext(source,context);
  const account=vm.runInContext('Account',context);account.client={auth};
  node('auth-email').value=' player@example.com ';node('auth-password').value='password123';node('auth-confirm').value='password123';
  return {account,node};
}
test('signup waits for email confirmation without opening controller',async()=>{
  let request,opened=false;const {account,node}=harness({signUp:async args=>{request=args;return {data:{session:null}};}});
  account.open=async()=>{opened=true;};account.setMode('signup');
  await account.submit({preventDefault(){}});
  assert.equal(request.email,'player@example.com');assert.equal(request.options.emailRedirectTo,'https://auction.example/?auth=confirmed');
  assert.equal(opened,false);assert.match(node('auth-message').textContent,/Check your email/);
});
test('password mismatch does not call signup',async()=>{
  let called=false;const {account,node}=harness({signUp:async()=>{called=true;}});
  account.setMode('signup');node('auth-confirm').value='wrong';await account.submit({preventDefault(){}});
  assert.equal(called,false);assert.match(node('auth-message').textContent,/do not match/);
});
test('login opens only the returned authenticated session',async()=>{
  const session={user:{id:'owner'}};let opened;
  const {account}=harness({signInWithPassword:async()=>({data:{session}})});
  account.open=async s=>{opened=s;};await account.submit({preventDefault(){}});assert.equal(opened,session);
});
test('reset email points to recovery screen',async()=>{
  let redirect;const {account}=harness({resetPasswordForEmail:async(email,options)=>{redirect=options.redirectTo;return {};}});
  account.setMode('forgot');await account.submit({preventDefault(){}});assert.equal(redirect,'https://auction.example/?auth=recovery');
});
test('new password is updated before opening workspace',async()=>{
  let password,opened=false;const {account}=harness({updateUser:async args=>{password=args.password;return {};},getSession:async()=>({data:{session:{user:{id:'owner'}}}})});
  account.open=async()=>{opened=true;};account.setMode('reset');await account.submit({preventDefault(){}});
  assert.equal(password,'password123');assert.equal(opened,true);
});
test('missing production configuration leaves login blocked',()=>{
  const {node}=harness();assert.equal(node('auth-submit').disabled,true);assert.match(node('auth-message').textContent,/configuration is missing/);
});
