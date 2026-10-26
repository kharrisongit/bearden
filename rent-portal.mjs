import {nextRentDate} from './public/rent-model.mjs';

export function rentPortalUrl(value){
 if(typeof value!=='string'||!value.trim()||value.length>2048)throw Object.assign(Error('portal'),{code:'portal'});
 let url;try{url=new URL(value.includes('://')?value.trim():'https://'+value.trim());}catch{throw Object.assign(Error('portal'),{code:'portal'});}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.port||!host.includes('.')||!/^[a-z0-9.-]+\.[a-z]{2,63}$/.test(host)||/(?:^|\.)(?:localhost|local|internal|lan|home|onion)$/.test(host)||host.endsWith('.')||/[\u0000-\u0020]/.test(value.trim())||[...url.searchParams.keys()].some(k=>/^(?:password|access_token|refresh_token|id_token|token|session|authorization|auth|code)$/i.test(k))||/(?:access_token|id_token|password)=/i.test(url.hash))throw Object.assign(Error('portal'),{code:'portal'});
 return url.href;
}

export function sameRentHost(value,portal){
 try{const url=new URL(rentPortalUrl(value)),host=new URL(rentPortalUrl(portal)).hostname;return url.hostname===host||url.hostname.endsWith('.'+host);}catch{return false;}
}

// Read only clearly labelled USD totals. Never infer rent from a payment button,
// transaction ledger, minimum payment, or conflicting totals of equal priority.
export function parseRentPage(text,now=Date.now()){
 if(typeof text!=='string'||text.length>120000||/\b(?:CAD|AUD|NZD|EUR|GBP)\b|[€£]|C\$|A\$/i.test(text))throw Object.assign(Error('unreadable'),{code:'unreadable'});
 const money='(?:USD\\s*|US\\s*\\$\\s*|\\$\\s*)(-?\\s*(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{2})(?:\\s*USD)?';
 for(const labels of ['current balance|total balance|rent balance','account balance|outstanding balance|balance due|total amount due','amount due|total due','balance']){
  const regex=new RegExp('(?:^|\\n)\\s*(?:'+labels+')\\s*:?\\s*'+money+'(?=\\s|$)','gi'),amounts=new Set();
  for(const match of text.matchAll(regex)){const n=Math.round(Number(match[1].replace(/[ ,]/g,''))*100);if(Number.isSafeInteger(n)&&Math.abs(n)<=1e10)amounts.add(n);}
  if(amounts.size>1)throw Object.assign(Error('unreadable'),{code:'unreadable'});
  if(amounts.size===1){const currentBalance=[...amounts][0];return {currentBalance,amountDue:currentBalance,currency:'USD',dueDate:nextRentDate(now),checkedAt:now};}
 }
 throw Object.assign(Error('unreadable'),{code:'unreadable'});
}
