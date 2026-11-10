// Browser sign-ins last 90 days. Renew at most daily during successful app use.
export const SESSION_SECONDS = 90 * 86400;
export const SESSION_MS = SESSION_SECONDS * 1000;
const RENEW_INTERVAL_MS = 86400000;

export function sessionRenewalExpiry(expires,now=Date.now()){
 return expires>now&&expires<=now+SESSION_MS-RENEW_INTERVAL_MS?now+SESSION_MS:null;
}

export function isSessionActivity({path,method,requestOrigin,fetchSite},origin){
 return ['GET','POST'].includes(method)&&path.startsWith('/api/')&&path!=='/api/logout'
  &&(!requestOrigin||requestOrigin===origin)&&(!fetchSite||['same-origin','none'].includes(fetchSite));
}
