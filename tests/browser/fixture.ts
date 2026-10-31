import { googleAmenities, googleSegment, itinerary, shoppingData, shoppingRequest } from '../fixtures';
export interface FlightRow { id: string; code?: number | null; pitch?: string | null; cabin?: number; emissionsCabin?: number; from?: string; to?: string; number?: string; date?: string; carrier?: string; emissions?: boolean; wifi?: number | null; ultraFastWifi?: number | null; amenities?: unknown }
export function rowHTML(r: FlightRow): string {
  const from = r.from || 'HND', to = r.to || 'ICN', number = r.number || '752';
  const carrier = r.carrier || 'KE', date = (r.date || '2026-12-04').replaceAll('-', '');
  return `<li><div data-id="${r.id}"><div jsname="HSrbLb"><div class="summary"><div class="time">09:00–12:00<br>${carrier} ${number}</div><div class="duration">3:00</div><div class="stops">${from}–${to}</div>${r.emissions === false ? '' : `<div class="co2" data-co2currentflight="100000" data-seatingclass="${r.emissionsCabin ?? r.cabin ?? 1}" data-travelimpactmodelwebsiteurl="https://www.travelimpactmodel.org/lookup/flight?itinerary=${from}-${to}-${carrier}-${number}-${date}">100 kg CO2e</div>`}<div class="price"><span data-gs="synthetic">¥50,000</span></div></div></div><button data-details aria-expanded="false">⌄</button><div jsname="XxAJue"></div></div></li>`;
}
export function dataFor(rows: FlightRow[]): unknown[] {
  return shoppingData(rows.map(r => {
    const segment = googleSegment(r.code === undefined ? 3 : r.code, r.pitch === undefined ? '32 in' : r.pitch, r.cabin || 1, r.from || 'HND', r.to || 'ICN', r.number || '752', r.date || '2026-12-04', r.carrier || 'KE');
    if (Object.hasOwn(r, 'amenities')) segment[12] = r.amenities;
    else if (Object.hasOwn(r, 'wifi') || Object.hasOwn(r, 'ultraFastWifi')) segment[12] = googleAmenities(r.wifi, r.ultraFastWifi);
    return itinerary(r.id, [segment]);
  }));
}
export function pageHTML(rows: FlightRow[], locale = 'en-US', bootstrap = true, cabin = 1): string {
  const data = JSON.stringify(dataFor(rows));
  return `<!doctype html><html lang="${locale}" dir="${['ar', 'iw', 'ur', 'fa'].includes(locale) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-fixture'; object-src 'none'; require-trusted-types-for 'script'"><style>
  *{box-sizing:border-box}body{margin:20px;font:14px Arial;color:#202124;background:#fff}main{max-width:1050px;margin:auto}ul{list-style:none;padding:0}li{position:relative;border:1px solid #ddd;padding:16px 50px 16px 16px}li>div{width:100%}.summary{display:flex;align-items:center;justify-content:space-between;gap:16px}.summary>div{min-width:0}.time{width:180px}.duration,.stops{width:100px}.co2{width:150px}.price{width:100px;text-align:end}button[data-details]{position:absolute;inset-inline-end:8px;top:12px;width:32px;height:32px}#other{height:20px}.dark{color:#eee;background:#202124}@media(max-width:600px){body{margin:4px}li{padding:8px 38px 8px 8px}.duration,.stops{display:none}.co2{width:60px}.price{width:72px}.time{width:70px}.summary{gap:6px}}
  </style><script nonce="fixture">
  window.audit={actions:0,expansions:0,requests:0,responses:[],mutations:0};
  window.fixturePolicy=trustedTypes.createPolicy('fixture',{createHTML:x=>x,createScript:x=>x});
  window.addBootstrap=data=>{const s=document.createElement('script');s.nonce='fixture';s.text=fixturePolicy.createScript("AF_initDataCallback({key:'ds:42',data:"+JSON.stringify(data)+",sideChannel:{}});");document.body.append(s)};
  const originalClick=HTMLElement.prototype.click;
  HTMLElement.prototype.click=function(){if(this.matches('[data-details]'))audit.actions++;return originalClick.call(this)};
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-details]')&&!e.isTrusted)audit.actions++},true);
  new MutationObserver(rs=>{for(const r of rs){if(r.type==='attributes'&&r.target.matches('[data-details]')&&r.target.getAttribute('aria-expanded')==='true')audit.expansions++;if(r.target instanceof Element&&r.target.closest('[data-seatspecs-cell]'))audit.mutations++;for(const n of r.addedNodes||[])if(n instanceof Element&&n.hasAttribute('data-seatspecs-cell'))audit.mutations++}}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-expanded','aria-label','lang','title','data-seatspecs-id']});
  window.AF_dataServiceRequests={'ds:42':{id:'LqxFAb',request:${JSON.stringify(shoppingRequest(cabin))}}};
  window.AF_initDataCallback=function(){};
  window.query=async function(body,mode='request'){
    const url='https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetShoppingResults';
    audit.requests++;
    if(mode==='xhr'||mode==='json')return await new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('POST',url);if(mode==='json')x.responseType='json';x.onload=()=>{audit.responses.push(mode==='json'?JSON.stringify(x.response):x.responseText);resolve(audit.responses.at(-1))};x.onerror=reject;x.send(body)});
    const response=mode==='request'?await fetch(new Request(url,{method:'POST',body})):await fetch(url,{method:'POST',body:new URLSearchParams(body)});
    const text=await response.text();audit.responses.push(text);return text;
  };
  window.replaceRows=html=>document.querySelector('ul').innerHTML=fixturePolicy.createHTML(html);
  </script></head><body><main><div id="other"><input value="search"></div><ul>${rows.map(rowHTML).join('')}</ul></main>
  ${bootstrap ? `<script nonce="fixture">AF_initDataCallback({key:'ds:42',data:${data},sideChannel:{}});</script>` : ''}
  <script nonce="fixture">document.addEventListener('click',e=>{const b=e.target.closest('[data-details]');if(b)b.setAttribute('aria-expanded',String(b.getAttribute('aria-expanded')!=='true'))});</script></body></html>`;
}
