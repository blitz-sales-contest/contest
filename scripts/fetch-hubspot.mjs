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
const LQ_FROM = Date.UTC(2026, 8, 30, 18, 30); // 2026-10-01 00:00 IST (start of OND quarter)
const WON_FROM = Date.UTC(2026, 8, 30, 18, 30); // 2026-10-01 00:00 IST

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
  ['dealname', 'hubspot_owner_id', 'dealstage', 'hs_v2_date_entered_qualifiedtobuy', 'drr', 'createdate', 'amount']);
const won = await search([...base, { propertyName: 'dealstage', operator: 'EQ', value: 'closedwon' }, { propertyName: 'closedate', operator: 'GTE', value: String(WON_FROM) }],
  ['dealname', 'hubspot_owner_id', 'closedate', 'drr', 'service_type', 'createdate']);

// ---- Count each deal once: on the FIRST day it ever entered Lead Qualified ----
// HubSpot's "date entered Lead Qualified" is overwritten when a deal is moved back
// into the stage (e.g. to fill in DRR), so we read the full stage history instead.
// A deal counts only if, before that first Lead Qualified entry, it had been in no
// Sales Pipeline stage other than "Appointment to be scheduled" (i.e. it is new, or
// it came up from Appointment to be scheduled). A deal created in a later stage and
// moved to Lead Qualified on the same day (IST) also counts. Reopened Closed Lost deals don't.
const ALLOWED_BEFORE_LQ = new Set(['appointmentscheduled']);
const SALES_STAGES = new Set(['appointmentscheduled', 'qualifiedtobuy', '48215108', 'decisionmakerboughtin', '1014542596', 'closedwon', 'contractsent', 'closedlost', '1016858950', '49708155', 'presentationscheduled']);

async function stageHistory(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals/batch/read', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: ids.slice(i, i + 50).map((id) => ({ id })), properties: ['dealstage'], propertiesWithHistory: ['dealstage'] }),
    });
    if (!res.ok) throw new Error('HubSpot history ' + res.status + ': ' + (await res.text()).slice(0, 300));
    const j = await res.json();
    for (const r of j.results || []) out[r.id] = ((r.propertiesWithHistory || {}).dealstage || []).map((h) => ({ v: h.value, t: Date.parse(h.timestamp) }));
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}

const hist = await stageHistory([...new Set([...lq.map((d) => d.id), ...won.map((d) => d.id)])]);
const counted = [];
const notCounted = [];
for (const d of lq) {
  const h = (hist[d.id] || []).slice().sort((a, b) => a.t - b.t);
  const firstLq = h.find((x) => x.v === 'qualifiedtobuy');
  const lqAt = firstLq ? firstLq.t : Date.parse(iso(d.properties.hs_v2_date_entered_qualifiedtobuy));
  const before = h.filter((x) => x.t < lqAt && SALES_STAGES.has(x.v));
  const istDay = (t) => new Date(t + 19800000).toISOString().slice(0, 10);
  const createdAt = Date.parse(iso(d.properties.createdate));
  const wasLost = before.some((x) => x.v === 'closedlost');
  // Created in a later stage by mistake and moved to Lead Qualified the same day (IST): counts as new.
  const sameDayFix = !wasLost && createdAt && istDay(createdAt) === istDay(lqAt) && before.every((x) => istDay(x.t) === istDay(lqAt));
  const cameFromLater = !sameDayFix && before.some((x) => !ALLOWED_BEFORE_LQ.has(x.v));
  const row = [d.id, d.properties.dealname || '', OWNERS[d.properties.hubspot_owner_id] || d.properties.hubspot_owner_id, d.properties.dealstage || '', new Date(lqAt).toISOString(), d.properties.drr == null || d.properties.drr === '' ? null : Number(d.properties.drr), d.properties.amount == null || d.properties.amount === '' ? null : Number(d.properties.amount)];
  if (cameFromLater) console.log(`Prior stages for deal ${d.id}: ${before.map((x) => x.v + '@' + new Date(x.t).toISOString().slice(0, 16)).join(', ')} -> first LQ ${new Date(lqAt).toISOString().slice(0, 16)}`);
  if (cameFromLater) notCounted.push([...row.slice(0, 4), iso(d.properties.hs_v2_date_entered_qualifiedtobuy), wasLost ? 'Reopened from Closed Lost' : 'Was already further in the pipeline before Lead Qualified']);
  else if (lqAt < LQ_FROM) {
    // First qualified before the tracking window; a recent re-entry into Lead Qualified.
    notCounted.push([...row.slice(0, 4), iso(d.properties.hs_v2_date_entered_qualifiedtobuy), 'Already qualified on ' + new Date(lqAt + 19800000).toISOString().slice(0, 10)]);
  } else counted.push(row);
}
// Re-entries that happened inside the window but whose first qualification is older are
// counted on their first day; list them too so the page can show they were not re-counted.
for (const d of lq) {
  const h = (hist[d.id] || []).slice().sort((a, b) => a.t - b.t);
  const lqEntries = h.filter((x) => x.v === 'qualifiedtobuy');
  if (lqEntries.length > 1 && !notCounted.some((n) => n[0] === d.id)) {
    const first = lqEntries[0].t;
    notCounted.push([d.id, d.properties.dealname || '', OWNERS[d.properties.hubspot_owner_id] || d.properties.hubspot_owner_id, d.properties.dealstage || '', iso(d.properties.hs_v2_date_entered_qualifiedtobuy), 'Moved back to Lead Qualified; counted on first qualification ' + new Date(first + 19800000).toISOString().slice(0, 10)]);
  }
}

const data = {
  updated_at: new Date().toISOString(),
  lq: counted,
  not_counted: notCounted,
  // [id, name, rep, close date, DRR, service type, first Lead Qualified (or created) time for TAT]
  won: won.map((d) => {
    const h = (hist[d.id] || []).slice().sort((a, b) => a.t - b.t);
    const f = h.find((x) => x.v === 'qualifiedtobuy');
    const start = f ? f.t : Date.parse(iso(d.properties.createdate));
    return [d.id, d.properties.dealname || '', OWNERS[d.properties.hubspot_owner_id] || d.properties.hubspot_owner_id, iso(d.properties.closedate),
      d.properties.drr == null || d.properties.drr === '' ? null : Number(d.properties.drr), d.properties.service_type || '', Number.isNaN(start) ? null : new Date(start).toISOString()];
  }),
};
writeFileSync('site/data.json', JSON.stringify(data));
for (const n of notCounted) console.log(`Not re-counted: deal ${n[0]} (${n[5]})`);
console.log(`Wrote site/data.json: ${data.lq.length} qualified, ${data.not_counted.length} re-entries not re-counted, ${data.won.length} won`);
