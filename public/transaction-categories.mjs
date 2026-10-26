// Categories describe posted transactions only; they never create scheduled bills.
export const transactionCategories = [
 ['groceries','Groceries','spending'],['dining','Dining','spending'],
 ['transport','Transport','spending'],['shopping','Shopping','spending'],
 ['personal','Health & personal','spending'],['entertainment','Entertainment','spending'],
 ['travel','Travel','spending'],['other','Other spending','spending'],
 ['rent','Rent','bill','rent'],['electric','Electric','bill','electric'],
 ['utilities','Utilities','bill','utility'],['insurance','Insurance','bill','insurance'],
 ['phone-internet','Phone & internet','bill','phone-internet'],['subscription','Subscriptions','bill','subscription'],
 ['debt','Debt payments','excluded'],['transfer','Transfers','excluded'],
 ['cash','Cash withdrawals','excluded'],['fees','Fees','excluded'],
].map(([key,label,kind,billKind])=>Object.freeze({key,label,kind,...(billKind?{billKind}: {})}));
const category = key => transactionCategories.find(c=>c.key===key);
const normalize = value => String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

// Remove bank wrappers and store/reference numbers, keeping the actual recipient.
// In particular, two different PayPal/Square sellers must not share a rule.
export function transactionMerchantKey(t){
 let name=String(t.merchant_name||t.name||'').toLowerCase()
  .replace(/^(?:pos\s+(?:(?:purchase|debit)\s+)?|(?:debit|credit)\s+card\s+purchase\s+|card\s+purchase\s+|purchase\s+(?:at|from)\s+)+/i,'')
  .replace(/\b(?:store|location|terminal|ref(?:erence)?)\s*#?\s*\d+\b/gi,'')
  .replace(/#\s*\d+\b/g,'').replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g,'')
  .replace(/\b\d{7,}\b/g,'').replace(/\s+\d{3,}\s*$/,'').trim()
  .replace(/^(?:sq|tst|sp|pp|paypal)\s*\*\s*/i,'');
 name=normalize(name);
 return !name||/^(?:transaction|purchase|payment|online payment|debit|credit|pos|transfer|paypal|square|sq|tst)$/.test(name)?'':name;
}
export const transactionCategoryKey=t=>JSON.stringify([t.itemId||t.source||'',t.account_id||'',t.transaction_id]);

function automaticCategory(t){
 const code=String(t.category||'').toUpperCase(),name=normalize(t.merchant_name||t.name);
 // Specific bank categories are stronger evidence than merchant guesses.
 const bank=[
  [/TRANSFER|INCOME/,'transfer'],[/LOAN_PAYMENTS/,'debt'],[/BANK_FEES/,'fees'],
  [/CASH_WITHDRAWAL|ATM_WITHDRAWAL/,'cash'],[/GROCERIES/,'groceries'],
  [/GAS_STATIONS|TRANSPORTATION/,'transport'],[/MEDICAL|PERSONAL_CARE/,'personal'],
  [/RENT_AND_UTILITIES_RENT$/,'rent'],[/GAS_AND_ELECTRICITY|ELECTRICITY/,'electric'],
  [/INSURANCE/,'insurance'],[/TELEPHONE|INTERNET_AND_CABLE/,'phone-internet'],
  [/RENT_AND_UTILITIES/,'utilities'],[/TRAVEL/,'travel'],
  [/FOOD_AND_DRINK_(?!OTHER)/,'dining'],
 ];
 for(const [pattern,key] of bank)if(pattern.test(code))return category(key);
 const merchants=[
  [/\b(?:transfer|zelle|venmo cashout)\b/,'transfer'],
  [/\b(?:credit card payment|visa payment|loan payment|mortgage|credit one payment|capital one payment)\b/,'debt'],
  [/\b(?:cash withdrawal|atm withdrawal)\b/,'cash'],
  [/\b(?:overdraft fee|maintenance fee|service charge|late fee)\b/,'fees'],
  [/\b(?:netflix|spotify|hulu|disney plus|disneyplus|apple music|youtube premium|subscription)\b/,'subscription'],
  [/\b(?:grocery|groceries|supermarket|kroger|aldi|trader joe s?|whole foods|safeway|publix|food lion)\b/,'groceries'],
  [/\b(?:mc ?donald s?|mcdonalds|starbucks|taco bell|burger king|wendy s?|restaurant|cafe|coffee|pizza|doordash|uber eats|grubhub|chipotle|panera|dunkin)\b/,'dining'],
  [/\b(?:gas station|shell oil|exxon|chevron|speedway|sunoco|marathon petroleum|uber|lyft|parking|transit)\b/,'transport'],
  [/\b(?:pharmacy|walgreens|cvs|dental|dentist|clinic|hospital|urgent care)\b/,'personal'],
  [/\b(?:rent|apartment lease)\b/,'rent'],
  [/\b(?:consumers energy|dte energy|electricity|electric(?: bill| payment| company))\b/,'electric'],
  [/\b(?:insurance|geico|progressive|state farm)\b/,'insurance'],
  [/\b(?:internet|wireless|comcast|xfinity|spectrum|verizon|at t|t mobile)\b/,'phone-internet'],
  [/\b(?:sewer|water (?:bill|department|dept|utility)|utilities)\b/,'utilities'],
  [/\b(?:airbnb|hotel|motel|airlines)\b/,'travel'],
  [/\b(?:cinema|movie theater|amc theatres|regal cinemas|steam games)\b/,'entertainment'],
  [/\b(?:amazon|amzn|walmart|wal mart|target|costco|home depot|lowe s?|best buy)\b/,'shopping'],
 ];
 for(const [pattern,key] of merchants)if(pattern.test(name))return category(key);
 for(const [pattern,key] of [[/FOOD_AND_DRINK/,'dining'],[/GENERAL_MERCHANDISE|HOME_IMPROVEMENT/,'shopping'],[/ENTERTAINMENT/,'entertainment']])if(pattern.test(code))return category(key);
 return category('other');
}

export function categorizeTransaction(t,preferences={}){
 const specific=preferences.transactions?.[transactionCategoryKey(t)],merchant=transactionMerchantKey(t);
 if(category(specific))return {...category(specific),source:'transaction'};
 if(specific!=='auto'&&merchant&&category(preferences.merchants?.[merchant]))return {...category(preferences.merchants[merchant]),source:'merchant'};
 return {...automaticCategory(t),source:'automatic'};
}

export function setTransactionCategory(preferences,t,key,remember=true){
 if(key!=='auto'&&!category(key))throw Error('Choose a transaction category.');
 const next={merchants:{...preferences?.merchants},transactions:{...preferences?.transactions}},id=transactionCategoryKey(t),merchant=transactionMerchantKey(t);
 if(remember&&merchant){
  if(key==='auto')delete next.merchants[merchant];else next.merchants[merchant]=key;
  delete next.transactions[id];
 }else next.transactions[id]=key;
 return next;
}
