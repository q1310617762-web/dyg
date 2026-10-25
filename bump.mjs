/* 把 HTML 里的资源版本号刷成「源码最后修改时间」。
 *
 * 为什么需要它：静态站靠 ?v= 破缓存，但改完 CSS/JS 忘了改版本号，
 * 浏览器就一直用旧文件。这个站已经因此踩过两次坑（皮肤脚本、这次的特效）。
 * 每次改完跑一遍：node bump.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = ['theme.css', 'ui.js', 'home.js', 'fx.js', 'cursor.js',
             'assets/petals.js', 'assets/starfield.js',
             'assets/miko-talk.js', 'assets/viz.js',
             'assets/drift.js'];

let newest = 0;
for (const f of SRC) {
  if (fs.existsSync(f)) newest = Math.max(newest, fs.statSync(f).mtimeMs);
}
const d = new Date(newest);
const pad = n => String(n).padStart(2, '0');
const stamp =
  d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
  pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());   // 精确到秒

let n = 0;
for (const f of fs.readdirSync('.').filter(x => x.endsWith('.html'))) {
  const s = fs.readFileSync(f, 'utf8');
  const out = s.replace(/(\?v=)[0-9a-z]+/g, `$1${stamp}`);
  if (out !== s) { fs.writeFileSync(f, out); n++; }
}

/* sw.js 里的 const V 必须和 HTML 的 ?v= 是同一个号：
   号一变 → 缓存名变 → activate 把旧缓存整个删掉，这就是「更新自动覆盖缓存」。
   sw.js 自己不进 SRC，否则每跑一次 bump 都会改自己，永远对不上。 */
if (fs.existsSync('sw.js')) {
  const s = fs.readFileSync('sw.js', 'utf8');
  const out = s.replace(/(const V = ')[0-9a-z]+(')/, `$1${stamp}$2`);
  if (out !== s) { fs.writeFileSync('sw.js', out); n++; }
}

console.log('版本号 ->', stamp, '｜ 改了', n, '个文件（HTML + sw.js）');
