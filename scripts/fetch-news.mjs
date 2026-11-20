// News of the day: trending D2C logistics headlines from Google News (RSS, free, no key).
// Writes site/news.json. Never fails the build: on any error it writes an empty list.
import { writeFileSync } from 'node:fs';

const QUERIES = [
  '("D2C" OR "direct-to-consumer") (logistics OR delivery OR "last mile" OR "quick commerce" OR shipping) India',
  '("quick commerce" OR "last-mile delivery" OR "same-day delivery" OR "ecommerce logistics") India',
];
const url = (q, d) => 'https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:' + d) + '&hl=en-IN&gl=IN&ceid=IN:en';
const unesc = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const tag = (x, t) => { const m = x.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return m ? unesc(m[1]) : ''; };

export function parse(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const source = tag(it, 'source');
    let title = tag(it, 'title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    return { title, link: tag(it, 'link'), source, at: new Date(tag(it, 'pubDate')).toISOString() };
  }).filter((n) => n.title && n.link && !isNaN(Date.parse(n.at)));
}

async function get(q, d) {
  const r = await fetch(url(q, d), { headers: { 'User-Agent': 'Mozilla/5.0 (blitz-sales-contest news)' } });
  if (!r.ok) throw new Error('Google News ' + r.status);
  return parse(await r.text());
}

let items = [];
try {
  for (const d of ['2d', '7d']) {
    const seen = new Set();
    items = [];
    for (const q of QUERIES) for (const n of await get(q, d)) {
      const k = n.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 60);
      if (!seen.has(k)) { seen.add(k); items.push(n); }
    }
    if (items.length >= 3) break;
  }
} catch (e) { console.log('News fetch failed: ' + e.message); items = []; }
writeFileSync('site/news.json', JSON.stringify({ updated_at: new Date().toISOString(), items: items.slice(0, 6) }));
console.log(`News: ${items.length} headlines`);
items.slice(0, 6).forEach((n, i) => console.log(`  ${i + 1}. ${n.title} — ${n.source} (${n.at.slice(0, 10)})`));
