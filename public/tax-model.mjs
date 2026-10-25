// 2026 IRS Publication 15-T, Worksheet 1A and annual percentage tables.
// Michigan Treasury 2026 withholding: 4.25%, $5,900 per MI-W4 exemption.
// Sources and supported scope are documented in docs/withholding.md.
export const TAX_YEAR=2026;
const rates=[0,.1,.12,.22,.24,.32,.35,.37];
const standard={joint:[[0,0],[19300,0],[44100,2480],[120100,11600],[230700,35932],[422850,82048],[531750,116896],[788000,206583.5]],single:[[0,0],[7500,0],[19900,1240],[57900,5800],[113200,17966],[209275,41024],[263725,58448],[648100,192979.25]],head:[[0,0],[15550,0],[33250,1770],[83000,7740],[121250,16155],[217300,39207],[271750,56631],[656150,191171]]};
const twoJobs={joint:[[0,0],[16100,0],[28500,1240],[66500,5800],[121800,17966],[217875,41024],[272325,58448],[400450,103291.75]],single:[[0,0],[8050,0],[14250,620],[33250,2900],[60900,8983],[108938,20512],[136163,29224],[328350,96489.63]],head:[[0,0],[12075,0],[20925,885],[45800,3870],[64925,8077.5],[112950,19603.5],[140175,28315.5],[332375,95585.5]]};
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
function value(n,label){const v=Number(n??0);if(!Number.isFinite(v)||v<0||v>1e9)throw Error('Enter a valid '+label+'.');return v;}
export function estimatePay(gross,settings={},options={}){
 gross=value(gross,'gross pay');if(!['single','joint','head'].includes(settings.filing))throw Error('Choose your filing status.');
 if(settings.state!=='MI')throw Error('Automatic state withholding currently supports Michigan. For another state, enter your actual take-home pay.');
 const n=26,bonus=!!options.bonus,exempt=settings.federalExempt===true,step2=settings.twoJobs===true;
 const health=bonus?0:value(settings.health,'pre-tax benefits'),retirement=bonus?0:value(settings.retirement,'pre-tax retirement'),afterTax=bonus?0:value(settings.afterTax,'other paycheck deductions'),local=bonus?0:value(settings.localTax,'local tax');
 if(health+retirement+afterTax>gross)throw Error('Paycheck deductions cannot exceed gross pay.');
 const taxable=Math.max(0,gross-health-retirement),ficaWages=Math.max(0,gross-health),ytd=value(settings.ytdWages,'year-to-date Social Security and Medicare wages');
 const allowance=value(settings.stateExemptions,'MI-W4 exemptions');if(!Number.isInteger(allowance)||allowance>99)throw Error('Use a whole number of MI-W4 exemptions (0–99).');
 let federal=0;
 if(!exempt){if(bonus){if(gross>1e6)throw Error('For a bonus over $1 million, use the payroll amount.');federal=taxable*.22;}else{const annual=Math.max(0,taxable*n+value(settings.otherIncome,'W-4 other income')-value(settings.deductions,'W-4 deductions')-(step2?0:settings.filing==='joint'?12900:8600)),table=(step2?twoJobs:standard)[settings.filing];let row=0;for(let i=1;i<table.length;i++)if(annual>=table[i][0])row=i;federal=Math.max(0,(table[row][1]+(annual-table[row][0])*rates[row]-value(settings.credits,'W-4 credits'))/n)+value(settings.extraFederal,'extra federal withholding');}}
 const state=settings.stateExempt===true?0:Math.max(0,taxable-(bonus?0:allowance*5900/n))*.0425+(bonus?0:value(settings.extraState,'extra state withholding'));
 const socialSecurity=Math.min(ficaWages,Math.max(0,184500-ytd))*.062,medicare=ficaWages*.0145+(Math.max(0,ytd+ficaWages-200000)-Math.max(0,ytd-200000))*.009;
 const parts={federal:round(federal),state:round(state),socialSecurity:round(socialSecurity),medicare:round(medicare),benefits:round(health+retirement+afterTax),local:round(local)};
 const total=round(Object.values(parts).reduce((a,b)=>a+b,0));return {year:TAX_YEAR,gross:round(gross),...parts,total,net:round(Math.max(0,gross-total)),rate:gross?round(total/gross*100):0};
}
