// Pulls the contest data from HubSpot and writes site/data.json.
// The token comes from the HUBSPOT_TOKEN repository secret; it is never stored in this repo.
import { writeFileSync } from 'node:fs';

const OWNERS = {
  '76903564': 'Krutika Pawar',
  '166075194': 'Noor Mohammed',
  '166420471': 'Prathush Nair',
  '167774851': 'Pritam Mazumdar',
};
const OWNER_IDS = Object.keys(OWNERS);
const LQ_FROM = Date.UTC(2026, 9, 4);   // 2026-10-04
const WON_FROM = Date.UTC(2026, 8, 30); // 2026-09-30

const token = process.env.HUBSPOT_TOKEN;
if (!token) { console.error('HUBSPOT_TOKEN secret is not set'); process.exit(1); }

const iso = (v) => {
  if (v == null || v === '') return null;
  if (/^\d+$/.test(String(v))) return new Date(Number(v)).toISOString();
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

async function search(filters, properties) {
  const rows = [];
  let after;
  for (let page = 0; page < 20; page++) {
    const body = { filterGroups: [{ filters }], properties, limit: 200 };
    if (after) body.after = after;
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HubSpot ' + res.status + ': ' + (await res.text()).slice(0, 300));
    const j = await res.json();
    rows.push(...(j.results || []));
    after = j.paging && j.paging.next && j.paging.next.after;
    if (!after) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return rows;
}

const base = [
  { propertyName: 'pipeline', operator: 'EQ', value: 'default' },
  { propertyName: 'hubspot_owner_id', operator: 'IN', values: OWNER_IDS },
];
const lq = await search([...base, { propertyName: 'hs_v2_date_entered_qualifiedtobuy', operator: 'GTE', value: String(LQ_FROM) }],
  ['dealname', 'hubspot_owner_id', 'dealstage', 'hs_v2_date_entered_qualifiedtobuy', 'drr']);
const won = await search([...base, { propertyName: 'dealstage', operator: 'EQ', value: 'closedwon' }, { propertyName: 'hs_v2_date_entered_closedwon', operator: 'GTE', value: String(WON_FROM) }],
  ['dealname', 'hubspot_owner_id', 'hs_v2_date_entered_closedwon']);

const data = {
  updated_at: new Date().toISOString(),
  lq: lq.map((d) => [d.id, d.properties.dealname || '', OWNERS[d.properties.hubspot_owner_id] || d.properties.hubspot_owner_id, d.properties.dealstage || '', iso(d.properties.hs_v2_date_entered_qualifiedtobuy), d.properties.drr == null || d.properties.drr === '' ? null : Number(d.properties.drr)]),
  won: won.map((d) => [d.id, d.properties.dealname || '', OWNERS[d.properties.hubspot_owner_id] || d.properties.hubspot_owner_id, iso(d.properties.hs_v2_date_entered_closedwon)]),
};
writeFileSync('site/data.json', JSON.stringify(data));
console.log(`Wrote site/data.json: ${data.lq.length} qualified, ${data.won.length} won`);
