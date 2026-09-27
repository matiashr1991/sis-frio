#pragma once
// Mobile-first setup wizard: W1 -> W2 (optional) -> MQTT -> Finish. Polls /api/status every 1 s and
// tolerates the phone dropping (AP channel switch during a WiFi test) for up to 45 s.
const char PAGE_HTML[] PROGMEM = R"HTML(<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>frio setup</title>
<style>
:root{color-scheme:light dark}
body{font:16px/1.4 system-ui,sans-serif;max-width:28em;margin:0 auto;padding:12px}
h1{font-size:1.3em;margin:.2em 0 .6em}h2{font-size:1.1em;margin:0 0 .6em}
.c{background:Canvas;border:1px solid #8886;border-radius:12px;padding:14px;margin:0 0 12px}
ol{display:flex;gap:4px;list-style:none;padding:0;margin:0 0 12px}
li{flex:1;text-align:center;font-size:.8em;padding:6px 2px;border-radius:8px;background:#8882;opacity:.6}
li.on{opacity:1;background:#06c;color:#fff}li.dn{opacity:1;background:#080;color:#fff}
input,button{display:block;width:100%;box-sizing:border-box;min-height:48px;font:inherit;padding:8px 12px;margin:0 0 10px;border-radius:10px;border:1px solid #8888}
button{background:#06c;color:#fff;border:0;font-weight:600}button.g{background:#8883;color:inherit}button:disabled{opacity:.5}
#m{padding:10px;border-radius:10px;margin:0 0 12px}#m:empty{display:none}
.busy{background:#fb04}.ok{background:#0a04}.err{background:#d334}
#z{font-size:.85em;opacity:.8;margin:0;word-break:break-all}
</style>
<body><h1>Frio setup</h1><ol id=l><li>WiFi 1<li>WiFi 2 (optional)<li>MQTT broker<li>Done</ol>
<p id=m role=status></p>
<div class=c><h2 id=t></h2>
<div id=fw><input id=s list=n placeholder=SSID maxlength=32 autocapitalize=off autocomplete=off><datalist id=n></datalist><input id=p type=password placeholder="WiFi password" maxlength=63 autocomplete=off></div>
<div id=fm hidden><input id=h placeholder="Broker host" maxlength=63 autocapitalize=off><input id=o type=number placeholder=Port value=1883><input id=u placeholder="User (optional)" maxlength=64 autocapitalize=off><input id=q type=password placeholder="Password (optional)" maxlength=64></div>
<button id=b>Test and save</button><button id=k class=g>Skip</button><button id=f class=g>Finish</button></div>
<p id=z></p>
<script>
var $=x=>document.getElementById(x),e=encodeURIComponent,T=['Primary WiFi','Secondary WiFi (optional)','MQTT broker','All set'],
R={no_ap:'SSID not found (2.4 GHz only? hidden?)',auth:'Wrong WiFi password',timeout:'Timed out',link:'WiFi link error',no_wifi:'Device has no WiFi',dns:'Host not found',refused:'Connection refused',unreachable:'Host unreachable',no_connack:'Broker did not answer',bad_credentials:'Wrong user or password',not_authorized:'Not authorized',nvs:'Could not save'},
tid=0,sk=0,fin=0,i=0,ok=Date.now();
function m(x,c){$('m').textContent=x;$('m').className=c||''}
function api(u,b){var c=new AbortController();setTimeout(()=>c.abort(),3000);
return fetch(u,{method:b?'POST':'GET',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:b,signal:c.signal}).then(r=>r.json())}
function view(j){
if(fin)return;
i=!j.w1?0:(!j.w2&&!sk)?1:!j.mq?2:3;
var r=j.state=='running';
if(r)m('Testing... the WiFi may drop for up to 40 s','busy');
else if(j.state=='ok')m('Saved','ok');
else if(j.state=='fail')m('Failed: '+(R[j.reason]||j.reason),'err');
else m('');
$('z').textContent='WiFi 1: '+(j.w1||'-')+' | WiFi 2: '+(j.w2||'-')+' | MQTT: '+(j.mq||'-');
$('t').textContent=T[i];$('fw').hidden=i>1;$('fm').hidden=i!=2;
[].forEach.call($('l').children,(x,n)=>x.className=n<i?'dn':n==i?'on':'');
$('b').hidden=i>2;$('b').disabled=r;$('k').hidden=i!=1;$('k').disabled=r;$('f').disabled=!j.w1||r}
function poll(){api('/api/status'+(tid?'?id='+tid:'')).then(j=>{ok=Date.now();view(j)})
.catch(()=>{if(!fin&&Date.now()-ok>45000)m('Connection lost. Rejoin the frio-xxxx WiFi and reload this page.','err')})
.then(()=>setTimeout(poll,1000))}
function sc(){api('/api/scan').then(j=>{if(j.state!='done')return setTimeout(sc,2000);
var d=$('n');d.textContent='';j.nets.forEach(n=>{var o=document.createElement('option');o.value=n.ssid;d.appendChild(o)})}).catch(()=>{})}
$('b').onclick=()=>{
var b='step='+['w1','w2','mq'][i]+(i<2?'&ssid='+e($('s').value)+'&pass='+e($('p').value):
'&host='+e($('h').value)+'&port='+e($('o').value)+'&user='+e($('u').value)+'&pass='+e($('q').value));
$('b').disabled=1;m('Sending...','busy');
api('/api/test',b).then(j=>{if(j.id)tid=j.id;else{m('Rejected: '+j.error,'err');$('b').disabled=0}}).catch(()=>m('Testing... the WiFi may drop for up to 40 s','busy'))};
$('k').onclick=()=>{sk=1;m('')};
$('f').onclick=()=>api('/api/finish','x=1').then(()=>{fin=1;m('Done. The device is connecting; you can close this page.','ok')});
poll();sc();
</script>)HTML";
