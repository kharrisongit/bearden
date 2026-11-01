import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';

const INDEX='bug-reports:index',AUTOMATION='bug-reports:automation';
const areas=new Set(['general','dashboard','wallet','debt','bills','income','accounts','connections','tools','settings','other']);
const statuses=new Set(['new','investigating','needs_details','fixed','closed']);
const types=new Set(['bug','feature']);
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
function text(value,label,max,required=false){
 if(value==null&&!required)return '';
 if(typeof value!=='string')fail(label+' must be text.');
 const result=value.trim();if(required&&!result)fail('Enter '+label.toLowerCase()+'.');
 if(result.length>max)fail(label+' is too long (maximum '+max+' characters).');
 return result;
}
function publicReport(report){
 const {id,createdAt,updatedAt,revision,title,details,expected,steps,area,appVersion,diagnostics,status,response,fixedInRelease}=report;
 return {id,type:report.type==='feature'?'feature':'bug',createdAt,updatedAt,revision,title,details,expected,steps,area,appVersion,diagnostics,status,response,fixedInRelease};
}
export function createBugReportStore({read,write,locked,release,now=()=>Date.now()}){
 const key=id=>'bug-report:'+id;
 const index=async()=>await read(INDEX,[]);
 async function list({accountId,admin=false,cursor,limit=25}={}){
  const rows=(await index()).filter(row=>admin||row.accountId===accountId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  const start=cursor?rows.findIndex(row=>row.id===cursor)+1:0;
  if(cursor&&start===0)fail('Report page expired. Reload the reports.');
  const size=Math.max(1,Math.min(25,Number(limit)||25)),page=rows.slice(start,start+size),reports=[];
  for(const row of page){const report=await read(key(row.id),null);if(report)reports.push(publicReport(report));}
  return {reports,nextCursor:start+size<rows.length?page.at(-1).id:null,...(admin?{release}: {})};
 }
 async function submit(accountId,input){return locked(async()=>{
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Enter a bug report or feature request.');
  const submissionId=text(input.submissionId,'Submission ID',80,true);if(!/^[\w-]{8,80}$/.test(submissionId))fail('Invalid submission ID. Reload and try again.');
  const id='BR-'+digest(accountId+'\0'+submissionId).slice(0,24),existing=await read(key(id),null),rows=await index();
  if(existing){if(existing.accountId!==accountId)fail('Report unavailable.',404);if(!rows.some(row=>row.id===id)){rows.push({id,accountId,createdAt:existing.createdAt});await write(INDEX,rows);}return {report:publicReport(existing)};}
  const time=now();if(rows.filter(row=>row.accountId===accountId&&Date.parse(row.createdAt)>time-86400000).length>=10)fail('You have sent 10 reports in the last 24 hours. Try again later.',429);
  if(rows.length>=2000)fail('The report queue is full. Ask the app owner to archive old reports.',429);
  const type=input.type===undefined?'bug':text(input.type,'Request type',20,true);if(!types.has(type))fail('Choose Bug report or Feature request.');
  const area=text(input.area||'other','Area',30);if(!areas.has(area))fail('Choose an area from the list.');
  const diagnostics=input.diagnostics&&typeof input.diagnostics==='object'&&!Array.isArray(input.diagnostics)?input.diagnostics:{};
  const stamp=new Date(time).toISOString(),report={id,type,accountId,createdAt:stamp,updatedAt:stamp,revision:1,title:text(input.title,'Title',120,true),details:text(input.details,type==='feature'?'Feature description':'What happened',4000,true),expected:text(input.expected,'Expected behavior',2000),steps:text(input.steps,'Steps',3000),area,appVersion:text(input.appVersion,'App version',100),diagnostics:{browser:text(diagnostics.browser,'Browser',240),viewport:text(diagnostics.viewport,'Viewport',40)},status:'new',response:'',fixedInRelease:null};
  await write(key(id),report);rows.push({id,accountId,createdAt:stamp});await write(INDEX,rows);
  return {report:publicReport(report)};
 });}
 async function update(input){return locked(async()=>{
  const id=text(input?.id,'Report ID',40,true);if(!/^BR-[a-f0-9]{24}$/.test(id))fail('Report not found.',404);
  const report=await read(key(id),null);if(!report)fail('Report not found.',404);
  if(!Number.isInteger(input.revision)||input.revision!==report.revision)fail('This report changed. Refresh before updating it.',409);
  if(!statuses.has(input.status))fail('Choose a valid report status.');
  if(input.status==='fixed'&&!(report.status==='fixed'&&report.fixedInRelease)&&!release.fixedReportIds?.includes(id))fail('This report can be marked fixed only after its fix is in the deployed release.',409);
  if(release.fixedReportIds?.includes(id)&&input.status!=='fixed')fail('This report is included in the deployed release. Submit a new report if the problem continues.',409);
  if(input.status==='closed'&&(report.status==='fixed'||report.fixedInRelease))fail('A deployed request cannot be closed without a fix. Submit a new report if needed.',409);
  const response=text(input.response,'Response',2000,input.status==='closed');
  const next={...report,status:input.status,response,fixedInRelease:input.status==='fixed'?(report.fixedInRelease||release.id):null,revision:report.revision+1,updatedAt:new Date(now()).toISOString()};
  await write(key(id),next);return {report:publicReport(next)};
 });}
 async function automation(){const value=await read(AUTOMATION,{});return {enabled:!!value.hash,connected:value.connected===true,...(value.taskId?{taskId:value.taskId,mode:value.mode||'session'}:{})};}
 async function manage(input){return locked(async()=>{
  const action=input?.action,current=await read(AUTOMATION,{});
  if(action==='connect'){const taskId=text(input.taskId,'Task ID',120,true),mode=input.mode||'session';if(!/^[\w-]+$/.test(taskId))fail('Invalid task ID.');if(!['session','token'].includes(mode))fail('Choose a valid connection mode.');if(mode==='token'&&!current.hash)fail('Create a reporting connection token first.');await write(AUTOMATION,{...current,connected:true,taskId,mode});return automation();}
  const connection=current.mode==='token'?{connected:false}:{connected:current.connected===true,...(current.taskId?{taskId:current.taskId,mode:'session'}:{})};
  if(action==='revoke'){await write(AUTOMATION,{hash:null,...connection});return automation();}
  if(!['enable','rotate'].includes(action))fail('Choose enable, rotate, revoke, or connect.');
  if(action==='enable'&&current.hash)return automation();
  const token='bdr_'+randomBytes(32).toString('base64url');await write(AUTOMATION,{hash:digest(token),...connection});return {...await automation(),token};
 });}
 async function authorize(authorization){
  if(typeof authorization!=='string'||!/^Bearer bdr_[\w-]{43}$/.test(authorization))return false;
  const saved=await read(AUTOMATION,{});if(typeof saved.hash!=='string'||!/^[a-f0-9]{64}$/.test(saved.hash))return false;
  return timingSafeEqual(Buffer.from(saved.hash,'hex'),Buffer.from(digest(authorization.slice(7)),'hex'));
 }
 async function appRelease(accountId){const setting=await automation();return {release,acknowledged:(await read('bug-reports:ack:'+accountId,null))?.releaseId===release.id,automationEnabled:setting.connected,automationTokenEnabled:setting.enabled};}
 async function acknowledge(accountId,input){if(input?.releaseId!==release.id)fail('A newer update is available. Refresh before dismissing it.',409);await write('bug-reports:ack:'+accountId,{releaseId:release.id});return {acknowledged:true};}
 return {list,submit,update,automation,manage,authorize,appRelease,acknowledge};
}
