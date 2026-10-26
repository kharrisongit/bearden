import test from 'node:test';
import assert from 'node:assert/strict';
import {rentLiveSocketURL} from '../public/rent-browser.mjs';

const address='live.browser.run/api/devtools/browser/example/page/tab?jwt=short-lived-test';
const view=wss=>'https://live.browser.run/ui/view?mode=tab&wss='+encodeURIComponent(wss);
test('mobile rent viewer connects only to the signed Cloudflare page socket',()=>{
 assert.equal(rentLiveSocketURL(view(address)),'wss://'+address);
 assert.equal(rentLiveSocketURL(view('wss://'+address)),'wss://'+address);
 for(const bad of ['evil.example/api/devtools/browser/a?jwt=x','ws://'+address,'https://'+address,'live.browser.run:123/api/devtools/browser/a?jwt=x','user@'+address,'live.browser.run/api/other?jwt=x','live.browser.run/api/devtools/browser/a'])assert.throws(()=>rentLiveSocketURL(view(bad)));
 assert.throws(()=>rentLiveSocketURL(view(address).replace('https://','http://')));
 assert.throws(()=>rentLiveSocketURL(view(address).replace('https://live.browser.run','https://evil.example')));
 assert.throws(()=>rentLiveSocketURL('https://live.browser.run/ui/view'));
});
