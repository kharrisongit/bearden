import {parseBill} from './providers.mjs';
const uniqueAmount=(text,pattern)=>{const amounts=[...new Set([...text.matchAll(pattern)].map(m=>Math.round(Number(m[1].replaceAll(',',''))*100)))];return amounts.length===1&&amounts[0]>=0&&amounts[0]<=1e12?amounts[0]:null;};
export function parseAccountEmail({id,mailboxId,from='',subject='',text='',receivedAt=new Date().toISOString()}){
 const sender=(from.match(/<([^>]+)>/)?.[1]||from).trim().toLowerCase();
 if(!/^[^\s<>]+@[^\s<>]+\.[^\s<>]+$/.test(sender))return null;
 const content=subject+'\n'+text;
 if(!/\b(bill|invoice|statement|balance|payment|autopay|paid|receipt|due)\b/i.test(content))return null;
 const amount=uniqueAmount(content,/(?<!minimum\s)(?:total\s+amount\s+due|amount\s+due|total\s+due|balance\s+due|(?:total\s+)?bill\s+amount|current\s+bill|bill\s+total)\s*(?:is\s*)?:?\s*\$\s*([\d,]+(?:\.\d{2})?)(?!\d|\.\d)/gi);
 const minimum=uniqueAmount(content,/(?:minimum\s+(?:payment(?:\s+due)?|amount\s+due|due))\s*(?:is\s*)?:?\s*\$\s*([\d,]+(?:\.\d{2})?)(?!\d|\.\d)/gi);
 const balance=uniqueAmount(content,/(?:statement\s+balance|new\s+balance|current\s+balance)\s*(?:is\s*)?:?\s*\$\s*([\d,]+(?:\.\d{2})?)(?!\d|\.\d)/gi);
 const creditLimit=uniqueAmount(content,/(?:total\s+)?credit\s+limit\s*(?:is\s*)?:?\s*\$\s*([\d,]+(?:\.\d{2})?)(?!\d|\.\d)/gi);
 const aprs=[...new Set([...content.matchAll(/(?:purchase\s+apr|annual\s+percentage\s+rate(?:\s*\(apr\))?|\bapr)\s*(?:is\s*)?:?\s*(\d{1,3}(?:\.\d+)?)\s*%/gi)].map(m=>Number(m[1])))];
 const apr=aprs.length===1&&aprs[0]>=0&&aprs[0]<=100?aprs[0]:null;
 const accountLast4=content.match(/(?:account|card)\s*(?:number|no\.?|#|ending(?:\s+in)?)?\s*[:*xX•-]*\s*(\d{4,})\b/i)?.[1]?.slice(-4)||'';
 const reference=content.match(/(?:confirmation|reference|payment)\s*(?:number|no\.?|#|id)\s*:?\s*([a-z0-9-]{5,})/i)?.[1]?.toLowerCase()||'';
 // Prefer the subject. Terms in a generic footer must not turn a statement into
 // a payment receipt. Confirmation without a settlement verb remains pending.
 const statusFor=value=>{
  if(/\bpayment\b[\s\S]{0,60}\b(failed|declined|returned|reversed|cancelled|canceled|not successful)\b|\b(?:unable|could not|cannot)\s+to\s+process\s+(?:your\s+)?payment\b|\bpayment\b[\s\S]{0,25}\bcould not be processed\b/i.test(value))return 'failed';
  if(/\bpayment\b[\s\S]{0,35}\b(?:will be|is being|not yet)\s+(?:received|posted|processed|completed)\b/i.test(value))return 'pending';
  if(/\bpayment\b[\s\S]{0,35}\b(posted|received|processed|completed|successful)\b|\bthank you for (?:your )?payment\b/i.test(value))return 'posted';
  if(/\bpayment\b[\s\S]{0,45}\b(submitted|scheduled|processing|pending|initiated|confirmation)\b|\b(?:submitted|scheduled)\s+(?:your\s+)?payment\b/i.test(value))return 'pending';
  return null;
 };
 let paymentStatus=statusFor(subject);
 if(!paymentStatus&&!/\b(statement|bill|invoice|balance|amount due|minimum due)\b/i.test(subject))paymentStatus=statusFor(text.slice(0,1800));
 let paymentAmount=uniqueAmount(content,/(?:payment\s+(?:of|amount)|amount\s+(?:paid|received))\s*(?:is\s*)?:?\s*\$\s*([\d,]+(?:\.\d{2})?)(?!\d|\.\d)/gi);
 if(paymentStatus&&paymentAmount===null)paymentAmount=uniqueAmount(content,/\$\s*([\d,]+(?:\.\d{2})?)(?!\d|\.\d)/g);
 const dueDate=parseBill(content,{referenceDate:receivedAt}).date;
 const paymentDates=[...new Set([...content.matchAll(/\b(?:payment date|scheduled for|payment scheduled on|payment received on|payment posted on)\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi)].map(m=>parseBill('Due date: '+m[1]).date).filter(Boolean))];
 const paymentDate=paymentStatus&&paymentDates.length===1?paymentDates[0]:null;
 return {id,mailboxId,sender,senderName:(from.includes('<')?from.split('<')[0].trim().replace(/^"|"$/g,''):sender).slice(0,150),subject:subject.slice(0,200),receivedAt,accountLast4,reference,amount,minimum,balance,dueDate,creditLimit,apr,paymentStatus,paymentAmount,paymentDate};
}
