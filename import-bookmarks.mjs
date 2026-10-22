/* ============================================================
   从 Chrome 导出的书签 HTML 生成起始页的「收藏」区

   用法：
     node import-bookmarks.mjs                     # 自动在「下载」里找 bookmarks*.html
     node import-bookmarks.mjs 路径/书签.html       # 指定文件
     node import-bookmarks.mjs 书签.html --out 临时.html   # 只生成到别的文件（用来预览）

   为什么要手动导出：Chrome 把账号书签存在 EncryptedAccountBookmarks2 里，
   本地是加密的，读不出 URL。导出成 HTML 是唯一可靠的方式。
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const fileArg = args.find((a, i) => !a.startsWith('--') && i !== outIdx + 1);

/* ---------- 找文件 ---------- */
function findExport() {
  if (fileArg) return fileArg;
  const dirs = [
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), '桌面'),
    process.cwd()
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    const hit = fs.readdirSync(d).find(f => /bookmark/i.test(f) && /\.html?$/i.test(f));
    if (hit) return path.join(d, hit);
  }
  return null;
}

const src = findExport();
if (!src) {
  console.error('✗ 没找到书签导出文件。');
  console.error('  在 Chrome 地址栏打开 chrome://bookmarks → 右上角 ⋮ → 导出书签，');
  console.error('  存到「下载」文件夹，再跑一次。');
  process.exit(1);
}

/* ---------- 解析 Netscape 书签格式 ---------- */
function decode(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

const html = fs.readFileSync(src, 'utf8');
const TOKEN = /<DT>\s*<H3[^>]*>([\s\S]*?)<\/H3>|<DT>\s*<A[^>]*HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>|<DL>|<\/DL>/gi;

const groups = [];
let stack = [{ name: '未分类', links: [] }];
let pending = null;
let m;

while ((m = TOKEN.exec(html))) {
  const tok = m[0];
  if (/^<DL>/i.test(tok)) {
    stack.push({ name: pending || '未命名', links: [] });
    pending = null;
  } else if (/^<\/DL>/i.test(tok)) {
    if (stack.length > 1) {
      const g = stack.pop();
      if (g.links.length) groups.push(g);
    }
  } else if (m[1] !== undefined) {
    pending = decode(m[1]);
  } else if (m[2] !== undefined) {
    const url = m[2].trim();
    if (!/^https?:\/\//i.test(url)) continue;            // 跳过 chrome:// javascript: file:
    stack[stack.length - 1].links.push({ url, title: decode(m[3]) || url });
  }
}

/* ---------- 归类 ---------- */
const seen = new Set();
for (const g of groups) {
  g.links = g.links.filter(l => {
    const key = l.url.replace(/#.*$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 链接太少的文件夹合并成「其他」，否则会冒出十几个只有一个链接的分组
const small = groups.filter(g => g.links.length < 2);
const big = groups.filter(g => g.links.length >= 2).sort((a, b) => b.links.length - a.links.length);
if (small.length > 1) {
  big.push({ name: '其他', links: small.flatMap(g => g.links) });
}

const MAX_GROUPS = 8;
const picked0 = big.slice(0, MAX_GROUPS);
// 组数一多就会排成两行，起始页会撑出屏幕 —— 那就每组少放几个
const MAX_PER = picked0.length > 4 ? 5 : 8;
const picked = picked0.map(g => ({ name: g.name, links: g.links.slice(0, MAX_PER) }));
const total = seen.size;

/* ---------- 生成 HTML ---------- */
const CJK = /[\u4e00-\u9fa5]/;

function monogram(title, url) {
  const t = title.replace(/^(https?:\/\/)?(www\.)?/, '').trim();
  if (CJK.test(t)) return [...t].find(c => CJK.test(c));
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
  const base = (host.split('.')[0] || t).replace(/[^a-z0-9]/gi, '');
  return (base[0] || '·').toUpperCase();
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const block = picked.map(g => `
        <div class="bm-g">
          <h3>${esc(g.name)}</h3>
${g.links.map(l => `          <a class="bm-l" href="${esc(l.url)}" target="_blank" rel="noopener"><i>${esc(monogram(l.title, l.url))}</i><span>${esc(l.title)}</span></a>`).join('\n')}
        </div>`).join('\n');

const target = outFile || 'index.html';
let page = fs.readFileSync('index.html', 'utf8');

const start = page.indexOf('<div class="bm-groups">');
const end = page.indexOf('</div>', page.indexOf('</div>', start) + 1);
// 用标签配平找真正的结束位置
function matchClose(s, openAt) {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = openAt;
  let depth = 0, mm;
  while ((mm = re.exec(s))) {
    if (mm[0] === '</div>') { depth--; if (depth === 0) return mm.index + 6; }
    else depth++;
  }
  return -1;
}
const closeAt = matchClose(page, start);
if (start < 0 || closeAt < 0) {
  console.error('✗ index.html 里找不到 .bm-groups 区块');
  process.exit(1);
}

page = page.slice(0, start) + '<div class="bm-groups">' + block + '\n      </div>' + page.slice(closeAt);
page = page.replace(/<span class="bm-note">[^<]*<\/span>/, `<span class="bm-note">${total} 个</span>`);

fs.writeFileSync(target, page);
console.log(`✓ 读取 ${path.basename(src)}：${total} 条书签`);
console.log(`✓ 生成 ${picked.length} 组，写入 ${target}`);
picked.forEach(g => console.log(`   · ${g.name}  ${g.links.length} 条`));
