import {billEvents,scenarioForecast,householdEnabled} from './income-model.mjs?v=forecast-report1';
import {contributionReclamationHorizon,coverBillShortfalls,contributionReclamationPlan} from './bills-savings.mjs?v=contribution-reclamation1';

const money=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100):'Unavailable';
const dateText=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const validDate=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;
const accountName=account=>String(account?.displayName||account?.name||'Selected account');
const debtLabels={full:'Full debt plan',minimum:'Minimums only',none:'No debt payments'};
const payoffLabels={snowball:'Snowball',avalanche:'Avalanche',burn:'Burn',squasher:'Squasher',cascade:'Cushion Cascade',cushioncascade:'Cushion Cascade',minimum:'Minimums',minimums:'Minimums',minimumsonly:'Minimums'};
const sum=(rows,key)=>rows.reduce((total,row)=>total+row[key],0);
const cashOrder=row=>row.type==='reclaim'?3:row.type==='extra-deposit'&&row.delta>0?0:row.delta<0?1:2;
const order=(a,b)=>a.date.localeCompare(b.date)||cashOrder(a)-cashOrder(b);

function rowDetail(row){
 if(row.reportDetail)return String(row.reportDetail);
 if(row.received)return 'Already included in the bank balance; no new cash movement.';
 if(row.type==='income')return row.fixedBillsTransfer
  ?'Take-home pay after Fixed Bills and other planned payments; the transfer is counted once.'
  :'Take-home pay after planned allocations.';
 if(row.type==='transfer')return 'Scheduled Fixed Bills contribution between your accounts.';
 if(row.type==='contribution')return 'Scheduled spouse contribution to the bills account.';
 if(row.type==='extra-deposit')return 'Saved extra deposit; still planned and not yet received.';
 if(row.type==='bill')return row.overdue?'Overdue unpaid bill, charged at the start of this forecast.':row.emailConfirmed||row.gmailConfirmed?'Amount or due date confirmed by the linked bill notice.':'Scheduled bill payment; future amounts can change.';
 return row.overdue?'Overdue scheduled item.':'Scheduled cash movement.';
}

// Rebuild balances from cash movements. In particular, coverBillShortfalls
// returns an adjusted opening/rows with inherited summary fields that are stale.
function audit(opening,events,start,end){
 const known=Number.isSafeInteger(opening);
 let balance=known?opening:null,low=balance,lowDate=known?start:null,income=0,outgoing=0;
 const ledger=events.map((event,index)=>{
  if(!validDate(event.date)||event.date<start||event.date>end)throw new Error('A forecast entry has an invalid date or falls outside the selected period. Refresh the forecast before exporting.');
  if(index&&events[index-1].date>event.date)throw new Error('Forecast entries are not in chronological order. Refresh the forecast before exporting.');
  if(!Number.isSafeInteger(event.delta))throw new Error('A forecast entry has an invalid amount. Refresh the forecast before exporting.');
  const incoming=event.incoming??(event.type==='income'?event.amount:Math.max(0,event.delta));
  const paid=event.outgoing??(event.type==='income'?event.allocations:Math.max(0,-event.delta));
  if(!Number.isSafeInteger(incoming)||!Number.isSafeInteger(paid)||incoming-paid!==event.delta)throw new Error('A forecast entry does not reconcile. Refresh the forecast before exporting.');
  income+=incoming;outgoing+=paid;
  if(!Number.isSafeInteger(income)||!Number.isSafeInteger(outgoing))throw new Error('The forecast amount is too large to export accurately.');
  if(balance!==null){
   balance+=event.delta;
   if(!Number.isSafeInteger(balance))throw new Error('The forecast balance is too large to export accurately.');
   if(balance<low){low=balance;lowDate=event.date;}
  }
  return {date:event.date,name:String(event.name||'Scheduled item'),detail:rowDetail(event),type:String(event.type||'item'),incoming,outgoing:paid,delta:event.delta,balance};
 });
 const firstNegative=known&&opening<0?{date:start,balance:opening,name:'Opening bank balance'}:(()=>{const row=ledger.find(r=>r.balance!==null&&r.balance<0);return row?{date:row.date,balance:row.balance,name:row.name}:null;})();
 const summary={opening:known?opening:null,income,outgoing,closing:balance,low,lowDate,firstNegative};
 const shortfalls=[];
 let episode=known&&opening<0?{start,end:null,low:opening,lowDate:start,firstBalance:opening,cause:'Opening bank balance'}:null;
 for(const row of ledger){
  if(row.balance===null)continue;
  if(row.balance<0){
   if(!episode)episode={start:row.date,end:null,low:row.balance,lowDate:row.date,firstBalance:row.balance,cause:row.name};
   if(row.balance<episode.low){episode.low=row.balance;episode.lowDate=row.date;}
  }else if(episode){episode.end=row.date;shortfalls.push(episode);episode=null;}
 }
 if(episode)shortfalls.push(episode);
 const monthly=[];
 if(validDate(start)&&validDate(end)&&end>=start){
  let cursor=start.slice(0,7),running=known?opening:null,index=0;
  while(cursor<=end.slice(0,7)){
   let monthIncome=0,monthOut=0,monthLow=running;
   while(index<ledger.length&&ledger[index].date.slice(0,7)===cursor){
    const row=ledger[index++];monthIncome+=row.incoming;monthOut+=row.outgoing;running=row.balance;
    if(running!==null)monthLow=Math.min(monthLow,running);
   }
   monthly.push({month:cursor,income:monthIncome,outgoing:monthOut,net:monthIncome-monthOut,closing:running,low:monthLow});
   const next=new Date(cursor+'-01T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
   cursor=next.toISOString().slice(0,7);
  }
 }
 return {summary,ledger,monthly,shortfalls};
}

function paycheckBreakdown(row){
 const fixedBills=row.fixedBillsTransfer||0,otherAllocations=row.allocations-fixedBills,items=[];
 if(fixedBills)items.push({kind:'transfer',label:'Fixed Bills transfer',amount:fixedBills});
 const details=row.allocationDetails;
 const complete=Array.isArray(details)&&details.every(item=>['budget','expense','debt','savings'].includes(item.kind)&&Number.isSafeInteger(item.amount))&&sum(details,'amount')===otherAllocations;
 if(complete)items.push(...details.filter(item=>item.amount!==0).map(item=>({kind:item.kind,label:String(item.label||'Planned payment'),amount:item.amount})));
 else if(otherAllocations)items.push({kind:'allocation',label:'Other planned payments',amount:otherAllocations});
 return {date:row.date,name:String(row.name||'Paycheck'),income:row.amount,allocations:row.allocations,fixedBills,otherAllocations,remaining:row.delta,items};
}

function emptyReclamation(context,start,buffer){
 const h=context?.household||{},personalStart=context?.plan?.state?.startDate||'',spouseStart=h.spouseStartDate||'';
 return {status:'unavailable',reason:'Set up a shared bills account, contributions and upcoming bills to calculate reclamation.',start,end:null,checkedThrough:null,buffer:Number.isSafeInteger(buffer)&&buffer>=0?buffer:null,
  contributions:[{person:'mine',label:'Your contribution',amount:Number.isSafeInteger(h.personalAmount)?h.personalAmount:null,start:personalStart,repeat:'biweekly'},{person:'spouse',label:'Spouse contribution',amount:Number.isSafeInteger(h.spouseAmount)?h.spouseAmount:null,start:spouseStart,repeat:h.spouseRepeat||'biweekly'}],
  baseline:null,projected:null,funding:{required:[],pending:[],totalRequired:0,totalPending:0,totalExtra:0},schedule:[],totals:{now:0,total:0,net:0,totalMine:0,totalSpouse:0,lowestAfter:null,lowDate:null,conditionalNow:false},explanations:[]};
}

function reclamationAnalysis(context,start,buffer,createdAt){
 const report=emptyReclamation(context,start,buffer);
 const unavailable=reason=>({...report,reason});
 if(!context||!householdEnabled(context.household)||!context.account)return report;
 const c=context,h=c.household,a=c.account,updated=Date.parse(a.balanceUpdated||a.balanceRetrieved||''),now=Date.parse(createdAt);
 if(a.balanceUnavailable||a.providerUnavailable||a.balanceStale||!Number.isSafeInteger(a.balance)||!Number.isFinite(updated)||!Number.isFinite(now)||now-updated>2*86400000)return unavailable('Reclamation needs a usable bills-account balance retrieved within the last two days. Refresh the bank connection and export again.');
 if(!validDate(c.plan?.state?.startDate)||!validDate(h.spouseStartDate))return unavailable('Set both payday dates so reclamations can be assigned to the correct person.');
 if(!Number.isSafeInteger(buffer)||buffer<0)return unavailable('Enter a valid nonnegative cushion in Find Savings before exporting reclamation.');
 const horizon=contributionReclamationHorizon(start);
 if(!horizon)return unavailable('The forecast date could not be read. Refresh and try again.');
 report.end=horizon.end;report.checkedThrough=horizon.checkedThrough;
 try{
  const length=Math.round((Date.parse(horizon.checkedThrough+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000);
  const bills=billEvents(c.billPlan||{},c.paymentsPlanner||{},c.linked||{},start,horizon.checkedThrough);
  const baseline=scenarioForecast(c.accounts||[],c.plan,bills,start,{debtMode:'none',length,household:h,scope:'shared',transactions:c.transactions||[]});
  report.baseline=audit(baseline.opening,baseline.rows,start,horizon.checkedThrough);
  if(!baseline.rows.some(row=>row.type==='bill'&&row.delta<0))return unavailable('Add upcoming bills and assign them to the shared bills account before calculating reclamation.');
  const funding=coverBillShortfalls(baseline,start,{buffer});
  if(!funding)return unavailable('The bills forecast needs a usable balance and valid scheduled amounts.');
  const savings=contributionReclamationPlan(funding.forecast,start,{end:horizon.end,buffer,personalStart:c.plan.state.startDate,spouseStart:h.spouseStartDate,personalContribution:h.personalAmount,spouseContribution:h.spouseAmount,spouseRepeat:h.spouseRepeat||'biweekly'});
  if(savings.status!=='ready')return unavailable('The adjusted reclamation forecast could not be calculated. Review the balance, contributions and bill amounts.');
  const saved=new Map((h.additionalDeposits||[]).map(deposit=>['extra:'+deposit.id,deposit]));
  const pending=baseline.rows.filter(row=>row.type==='extra-deposit'&&row.delta>0).map(row=>({date:row.date,amount:row.delta,source:['personal','other'].includes(saved.get(row.id)?.source)?saved.get(row.id).source:'unassigned'}));
  const required=funding.deposits.map(({date,neededBy,amount,shortfall,reason})=>({date,neededBy,amount,shortfall,reason}));
  const proposed=required.map((deposit,index)=>({id:'report-proposed-'+index,date:deposit.date,name:'Proposed extra deposit',type:'extra-deposit',delta:deposit.amount,incoming:deposit.amount,outgoing:0,reportDetail:'Funding source unassigned. Deposit needed by '+dateText(deposit.neededBy)+' for '+deposit.reason+'.'}));
  const schedule=savings.schedule.map(({date,person,contributionDate,amount,balanceAfter})=>({date,person,contributionDate,amount,balanceAfter}));
  const withdrawals=schedule.map((row,index)=>({id:'report-reclaim-'+index,date:row.date,name:row.person==='mine'?'Your contribution reclamation':'Spouse contribution reclamation',type:'reclaim',delta:-row.amount,incoming:0,outgoing:row.amount,reportDetail:'From the '+dateText(row.contributionDate)+' third paycheck; after this day\'s bills and deposits clear.'}));
  // Keep the actual bank opening, including a current shortage, visible. Today's
  // saved/proposed deposits are explicit events and therefore counted only once.
  const projected=audit(baseline.opening,[...baseline.rows,...proposed,...withdrawals].sort(order),start,horizon.checkedThrough);
  const totalRequired=sum(required,'amount'),totalPending=sum(pending,'amount');
  const totalMine=sum(schedule.filter(row=>row.person==='mine'),'amount'),totalSpouse=sum(schedule.filter(row=>row.person==='spouse'),'amount');
  const explanations=[
   'Eligible contributions come from each person\'s third biweekly paycheck in a calendar month. A third paycheck is an opportunity to review, not automatically spare cash.',
   'Each person is capped at their configured contribution for each eligible payday. A partial or delayed reclamation keeps the original person and contribution date.',
   'The calculation checks every later deposit and bill through '+dateText(horizon.checkedThrough)+'. It releases only the amount that fits after earlier suggested reclamations and the '+money(buffer)+' cushion.',
   'All listed reclamations form one combined plan. Take each amount once, after that day\'s deposits and bills clear; the rows are not separate alternatives.',
   'Bills may settle before a same-day scheduled contribution. Event-level lows remain in this report even if the closing balance for that day recovers.',
   'Existing nonnegative dips below the cushion are allowed. New extra funding is proposed only for original negative balances, not merely to fund a reclamation.',
   'A one-time deposit covers its original shortfall and restores the cushion. Newly proposed funding has no assigned source and has not been added to the personal forecast.',
   'Calculating or exporting this report does not move money, save proposed deposits, or mark any funds received.'
  ];
  if(h.spouseRepeat&&h.spouseRepeat!=='biweekly')explanations.push('The spouse\'s '+h.spouseRepeat+' contributions fund bills but are not treated as third biweekly paychecks for reclamation.');
  if(funding.extraFunding>0)explanations.push('This reclamation plan is conditional on '+money(funding.extraFunding)+' of extra funding: '+money(totalPending)+' already saved as planned deposits and '+money(totalRequired)+' newly proposed. Net contributions released are '+money(savings.total-funding.extraFunding)+'.');
  if(savings.total<funding.extraFunding)explanations.push('The plan requires more added funding than it releases. The added money covers bills; it does not create a net reclamation.');
  if(baseline.opening<0&&funding.conditionalNow)explanations.push('The audit begins with the actual negative bank balance before today\'s conditional deposits. The lowest balance after the calculator applies today\'s required funding is '+money(savings.lowAfter)+'.');
  if(report.baseline.shortfalls.length)explanations.push('The original bills schedule already has '+report.baseline.shortfalls.length+' negative-balance period'+(report.baseline.shortfalls.length===1?'':'s')+' before any reclamation. Proposed deposits address those existing gaps; reclamations are calculated only after that repair.');
  return {...report,status:'ready',reason:'',projected,funding:{required,pending,totalRequired,totalPending,totalExtra:funding.extraFunding},schedule,totals:{now:savings.now,total:savings.total,net:savings.total-funding.extraFunding,totalMine,totalSpouse,lowestAfter:savings.lowAfter,lowDate:savings.lowDate,conditionalNow:funding.conditionalNow},explanations};
 }catch(error){
  return unavailable('Reclamation could not be calculated from this snapshot. '+(error instanceof Error?error.message:'Refresh the forecast and try again.'));
 }
}

/** Build a portable report snapshot without writing settings or moving money. */
export function buildForecastReport({scope,forecast,start,plan={},account,context,buffer=10000,generatedAt=new Date().toISOString()}){
 if(!forecast||!validDate(start)||!validDate(forecast.end)||forecast.end<start)throw new Error('The forecast period is unavailable. Reload the forecast before exporting.');
 const view=scope==='bills'||scope==='shared'?'bills':'personal',end=forecast.end,debtMode=['full','minimum','none'].includes(forecast.debtMode)?forecast.debtMode:'full';
 const createdAt=Number.isFinite(Date.parse(generatedAt))?new Date(generatedAt).toISOString():new Date().toISOString();
 const main=audit(forecast.opening,forecast.rows||[],start,end);
 const debtLabel=view==='bills'?'Shared bills and contributions':debtLabels[forecast.debtMode]||debtLabels.full;
 const paychecks=(forecast.rows||[]).filter(row=>row.type==='income').map(paycheckBreakdown);
 const title=view==='bills'?'Bills Account Simulation':'Personal Spending Simulation';
 const narratives=[];
 if(main.summary.opening===null)narratives.push('The selected account balance is unavailable. Scheduled income and outflow are shown, but closing balances, lowest balances and negative-balance periods cannot be confirmed.');
 else{
  narratives.push('The forecast starts with '+money(main.summary.opening)+' in '+accountName(account)+'. Adding '+money(main.summary.income)+' of expected '+(view==='bills'?'deposits':'take-home income')+' and subtracting '+money(main.summary.outgoing)+' of planned outflow leaves '+money(main.summary.closing)+' on '+dateText(end)+'.');
  if(main.summary.outgoing>main.summary.income)narratives.push('Planned outflow exceeds incoming money by '+money(main.summary.outgoing-main.summary.income)+'. That difference uses the starting bank balance; it does not by itself mean the account goes negative. The timing of each ledger entry determines the actual low.');
  if(main.summary.firstNegative){const first=main.summary.firstNegative;narratives.push('The first projected negative balance is '+money(first.balance)+' on '+dateText(first.date)+' after '+first.name+'. The lowest balance is '+money(main.summary.low)+' on '+dateText(main.summary.lowDate)+'.');}
  else narratives.push('No negative event balance is projected in the selected period. The lowest balance is '+money(main.summary.low)+' on '+dateText(main.summary.lowDate)+'.');
 }
 narratives.push(view==='personal'?'Paycheck income is take-home pay, not gross wages. The paycheck rows show money remaining after Fixed Bills and planned allocations. Unspent personal budget allowances stay available until spent.':'Only the selected bills account, its scheduled contributions and its assigned bills are included. Your personal paycheck is not deposited into this account as income.');
 narratives.push('This report includes every scheduled entry through '+dateText(end)+', including entries beyond the current chart selection or on-screen ledger limit.');
 const h=context?.household||{},updated=account?.balanceUpdated||account?.balanceRetrieved;
 const assumptions=[
  {label:'Account',value:accountName(account)},
  {label:'Selected simulation period',value:dateText(start)+' through '+dateText(end)},
  {label:'Debt scenario',value:debtLabel},
  {label:'Opening balance',value:main.summary.opening===null?'Unavailable':money(main.summary.opening)+' from the selected bank account'},
  {label:'Bank balance retrieved',value:updated&&Number.isFinite(Date.parse(updated))?new Date(updated).toISOString():'Timestamp unavailable'},
  {label:'Payday schedule',value:validDate(plan.state?.startDate)?'Every two weeks from '+dateText(plan.state.startDate):'Payday date not configured'},
  {label:'Cash-flow timing',value:view==='personal'?'Payday-funded Fixed Bills are included once in paycheck remaining. Other bills can settle before same-day income.':'Positive extra deposits run first, then bills, scheduled contributions, and finally proposed reclamations.'},
  {label:'Future bill amounts',value:'Current scheduled amounts are estimates and can change. Paid or received entries are not deducted or deposited again.'},
  {label:'Currency',value:'USD; every calculation uses whole cents.'}
 ];
 if(householdEnabled(h)){
  assumptions.push({label:'Your Fixed Bills contribution',value:money(h.personalAmount)+' each biweekly payday'});
  assumptions.push({label:'Spouse contribution',value:money(h.spouseAmount)+' '+(h.spouseRepeat||'biweekly')+(validDate(h.spouseStartDate)?' from '+dateText(h.spouseStartDate):'')});
 }
 if(view==='personal'){
  const method=typeof plan.state?.payoffMethod==='string'?plan.state.payoffMethod.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim():'';
  if(method)assumptions.push({label:'Saved payoff method',value:payoffLabels[method.toLowerCase().replace(/[\s_-]/g,'')]||method});
  assumptions.push({label:'Spending allowances',value:'Recurring personal allowances remain available. Actual one-time expenses, savings and the selected debt payments remain planned outflows.'});
  assumptions.push({label:'Posted purchases',value:'Past purchases are already reflected in the current bank balance and are not deducted a second time.'});
 }
 if(account?.balanceStale||account?.providerUnavailable)assumptions.push({label:'Balance quality',value:'The saved balance is stale or its provider is unavailable. Refresh before relying on projected balances.'});
 const reclamation=reclamationAnalysis(context,context?.today||start,buffer,createdAt);
 return {title,subtitle:'BearDen forecast and contribution review',createdAt,filename:'BearDen-'+(view==='bills'?'Bills':'Personal-'+debtMode)+'-'+start+'-to-'+end+'.pdf',start,end,scope:view,accountName:accountName(account),debtLabel,...main,narratives,assumptions,paychecks,reclamation};
}
