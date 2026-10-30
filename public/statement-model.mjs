// All report arithmetic uses integer cents. Original documents never enter storage.
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const moneyPattern = /(?:-?\$\s*[\d,]+\.\d{2}-?|\([\d,$.]+\)|-?[\d,]+\.\d{2}(?:\s*CR)?)/gi;
export function readCents(value) {
  const text = String(value ?? '').trim();
  if (!text || !/^\(?-?\$?\s*[\d,]+(?:\.\d{1,2})?\)?-?(?:\s*CR)?$/i.test(text)) return null;
  const n = Math.round(Number(text.replace(/[^\d.]/g,'')) * 100);
  return Number.isSafeInteger(n) && n <= 100000000 ? n * (/[-(]|CR/i.test(text) ? -1 : 1) : null;
}
export function readMonth(value) {
  const text = String(value ?? '').trim();
  let match = text.match(/\b(20\d{2})[-/](\d{1,2})(?:[-/]\d{1,2})?\b/);
  if (match && +match[2] >= 1 && +match[2] <= 12) return `${match[1]}-${match[2].padStart(2,'0')}`;
  match = text.match(/\b(\d{1,2})[/-](?:(\d{1,2})[/-])?(20\d{2})\b/);
  if (match && +match[1] >= 1 && +match[1] <= 12) return `${match[3]}-${match[1].padStart(2,'0')}`;
  match = text.match(/\b([a-z]{3,9})\.?\s+(?:\d{1,2},?\s+)?(20\d{2})\b/i);
  const index = match ? MONTHS.findIndex(m => m.slice(0,3).toLowerCase() === match[1].slice(0,3).toLowerCase()) : -1;
  return index < 0 ? null : `${match[2]}-${String(index+1).padStart(2,'0')}`;
}
const dateISO = text => {
  const m = String(text).match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (!m) return '';
  const date = `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  return new Date(date+'T12:00:00Z').toISOString().slice(0,10) === date ? date : '';
};
function amounts(text) { return [...text.matchAll(moneyPattern)].map(m => readCents(m[0])).filter(n => n !== null); }
function consumersRows(text) {
  const starts = [...text.matchAll(/(?<!Total )Current\s+Bill\s*\([^)]*\)\s*-?\s*([A-Za-z]+)\s+(20\d{2})/gi)];
  return starts.flatMap((match,index) => {
    const block = text.slice(match.index, starts[index+1]?.index ?? text.length);
    const total = block.match(/Total\s+Current\s+Bill\s+due\s+on\s+or\s+before\s+(\d{1,2}\/\d{1,2}\/20\d{2})\s+(-?\$\s*[\d,]+\.\d{2})/i);
    if (!total) return [];
    const row = {month:readMonth(`${match[1]} ${match[2]}`), amount:readCents(total[2]), dueDate:dateISO(total[1]), included:true};
    for (const kind of ['electric','gas','tax']) {
      const line = block.match(new RegExp('^\\s*'+kind+'\\s+([^\\n]+)','im'))?.[1];
      if (line) row[kind] = amounts(line).at(-1) ?? null;
      if (kind === 'electric' && line) {
        const days = line.match(/\d{1,2}\/\d{1,2}\/20\d{2}\s+\d{1,2}\/\d{1,2}\/20\d{2}\s+(\d+)/)?.[1];
        if (days) row.days = Number(days);
      }
    }
    row.included = !(row.days && row.days < 20);
    if (!row.included) row.note = `Short billing period (${row.days} days)`;
    return row.month && row.amount !== null ? [row] : [];
  });
}
function csvCells(line, delimiter) {
  const cells = []; let cell = '', quoted = false;
  for (let i=0;i<line.length;i++) {
    if (line[i] === '"') { if (quoted && line[i+1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (line[i] === delimiter && !quoted) { cells.push(cell.trim()); cell = ''; }
    else cell += line[i];
  }
  return [...cells,cell.trim()];
}
function tableRows(text) {
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean), rows=[];
  const headerIndex = lines.findIndex(l=>/month|date|period/i.test(l) && /amount|charge|cost|total|bill/i.test(l) && /[,;\t]/.test(l));
  if (headerIndex >= 0) {
    const delimiter = lines[headerIndex].includes('\t') ? '\t' : lines[headerIndex].includes(';') ? ';' : ',';
    const headers=csvCells(lines[headerIndex],delimiter).map(x=>x.toLowerCase().replace(/[^a-z]/g,''));
    const monthIndex=headers.findIndex(h=>['month','billmonth','billingmonth','period','date','billingdate','statementdate'].includes(h));
    const amountIndex=headers.findIndex(h=>['amount','charges','currentcharges','billamount','total','totalcharges','cost'].includes(h));
    if(monthIndex>=0 && amountIndex>=0) for(const line of lines.slice(headerIndex+1)) {
      const cells=csvCells(line,delimiter), month=readMonth(cells[monthIndex]), amount=readCents(cells[amountIndex]);
      if (!month || amount === null) continue;
      const row={month,amount,included:true};
      for (const key of ['electric','gas','tax']) { const i=headers.indexOf(key); if(i>=0) row[key]=readCents(cells[i]); }
      rows.push(row);
    }
  }
  if (rows.length) return rows;
  // Conservative fallback for a simple Month/Date + Amount table. Multi-amount
  // rows and payment/balance lines need review instead of guessing a column.
  for (const line of lines) {
    if (/payment|balance|transfer|previous|past due|kwh|therm/i.test(line)) continue;
    const month = readMonth(line), values = amounts(line);
    if (month && values.length === 1 && /^(?:20\d{2}[-/]|\d{1,2}[/-]|[A-Za-z]{3,9}\.?\s)/.test(line)) rows.push({month,amount:values[0],included:true});
  }
  return rows;
}
export function parseStatement(text) {
  text=String(text).replace(/\u00a0/g,' ').replace(/\r/g,'');
  if (text.length > 2000000) throw Error('This statement is too large. Use a shorter billing history.');
  const consumers = consumersRows(text), rows = consumers.length ? consumers : tableRows(text);
  if(rows.length>120) throw Error('This file has over 120 bill rows. Upload a shorter history.');
  const unique=[], seen=new Set();let duplicates=0;
  for(const row of rows) { const key=[row.month,row.amount,row.dueDate||''].join(':');if(seen.has(key)){duplicates++;continue;}seen.add(key);unique.push(row); }
  const months=[...new Set(unique.filter(r=>r.included).map(r=>r.month))].sort().slice(-12);
  for(const row of unique) if(row.included&&!months.includes(row.month)){row.included=false;row.note='Older than the latest 12 bill months';}
  return {name:consumers.length?'Consumers Energy':'Utility bill',rows:unique.sort((a,b)=>a.month.localeCompare(b.month)),warnings:[
    ...(consumers.length?['Totals include electricity, gas, and tax. Previous balances, transfers, and payments are excluded.']:['Check that each amount is a new bill charge, not a payment, usage reading, or carried balance.']),
    ...(duplicates?[`${duplicates} duplicate row${duplicates===1?' was':'s were'} removed.`]:[]),
    ...(!rows.length?['No monthly charges could be identified. Add the month and total charge below, or upload a CSV with Month and Amount columns.']:[])
  ]};
}
export function analyzeStatement(input, options={}) {
  const groups=new Map();
  for(const row of input.filter(r=>r.included!==false)) {
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(row.month)||!Number.isSafeInteger(row.amount)||Math.abs(row.amount)>100000000) throw Error('Every included row needs a valid month and bill amount.');
    const group=groups.get(row.month)||{month:row.month,amount:0,bills:0,dueDates:[]};
    group.amount+=row.amount;group.bills++;
    if(row.dueDate&&!group.dueDates.includes(row.dueDate))group.dueDates.push(row.dueDate);
    for(const kind of ['electric','gas','tax']) if(Number.isSafeInteger(row[kind]))group[kind]=(group[kind]||0)+row[kind];
    groups.set(row.month,group);
  }
  const rows=[...groups.values()].sort((a,b)=>a.month.localeCompare(b.month)).slice(-12);
  if(!rows.length) throw Error('Include at least one bill month to create a report.');
  const count=rows.length,total=rows.reduce((s,r)=>s+r.amount,0),average=Math.round(total/count);
  if(total<=0) throw Error('The selected charges total zero or a credit. Select a longer history with positive costs for a budget recommendation.');
  const suggestedBudget=Math.ceil(total/(count*2500))*2500;
  const budget=options.budget??suggestedBudget;
  if(!Number.isSafeInteger(budget)||budget<0||budget>100000000)throw Error('Enter a monthly budget between $0 and $1,000,000.');
  const serial=month=>Number(month.slice(0,4))*12+Number(month.slice(5))-1;
  const complete=count===12&&serial(rows.at(-1).month)-serial(rows[0].month)===11;
  const peak=rows.reduce((a,b)=>b.amount>a.amount?b:a),lowest=rows.reduce((a,b)=>b.amount<a.amount?b:a);
  let seasonalDraw=0;
  for(let start=0;start<count;start++) {
    let draw=0;
    for(let n=0;n<(complete?count:count-start);n++){draw+=rows[(start+n)%count].amount-budget;seasonalDraw=Math.max(seasonalDraw,draw);}
  }
  const suggestedReserve=Math.ceil((seasonalDraw+Math.max(0,peak.amount)*0.25)/10000)*10000;
  const reserve=options.reserve??suggestedReserve;
  if(!Number.isSafeInteger(reserve)||reserve<0||reserve>100000000)throw Error('Enter a starting reserve between $0 and $1,000,000.');
  const nextMonth=Number(rows.at(-1).month.slice(5))%12+1;
  const startMonth=Number(options.startMonth)||nextMonth;
  const ordered=complete?[...rows].sort((a,b)=>((Number(a.month.slice(5))-startMonth+12)%12)-((Number(b.month.slice(5))-startMonth+12)%12)):rows;
  let balance=reserve,minBalance=reserve;
  const simulation=ordered.map(row=>{const opening=balance;balance+=budget-row.amount;minBalance=Math.min(minBalance,balance);return {...row,opening,budget,change:budget-row.amount,balance};});
  let highestStretch=null;
  if(count>=3) for(let i=0;i<(complete?count:count-2);i++) {
    const stretch=[rows[i],rows[(i+1)%count],rows[(i+2)%count]],sum=stretch.reduce((s,r)=>s+r.amount,0);
    if(!complete&&serial(stretch[2].month)-serial(stretch[0].month)!==2)continue;
    if(!highestStretch||sum>highestStretch.total)highestStretch={rows:stretch,total:sum,extra:Math.max(0,sum-budget*3)};
  }
  return {rows,count,total,average,complete,peak,lowest,budget,reserve,startMonth,suggestedBudget,suggestedReserve,seasonalDraw,simulation,minBalance,endingBalance:balance,surplus:budget*count-total,highestStretch};
}
