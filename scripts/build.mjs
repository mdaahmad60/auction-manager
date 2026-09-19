import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export function publicConfig(env) {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env.local or deployment environment variables.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('SUPABASE_URL must be the HTTPS project origin.');
  let valid = key.startsWith('sb_publishable_');
  if (key.startsWith('eyJ')) {
    try { valid = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch (_) {}
  }
  if (!valid) throw new Error('Use a Supabase publishable or legacy anon key, never a secret or service_role key.');
  return { supabaseUrl: parsed.origin, supabaseKey: key, localMode: false, ...(env.LIVE_OVERVIEW === 'cloudflare' ? {liveOverview:'cloudflare'} : {}) };
}
export async function build(env = process.env) {
  const config = publicConfig(env);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = path.join(root, 'dist');
  await rm(output, {recursive:true, force:true});
  await mkdir(output, {recursive:true});
  for (const entry of ['index.html','scripts','themes','vendor']) {
    await cp(path.join(root,entry), path.join(output,entry), {recursive:true, filter:source => !source.endsWith('.mjs')});
  }
  await writeFile(path.join(output,'config.js'), 'window.APP_CONFIG = ' + JSON.stringify(config).replace(/</g,'\\u003c') + ';\n');
  await cp(path.join(root,'cloudflare/_headers'), path.join(output,'_headers'));
  console.log('Built dist/ with public Supabase configuration.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
