const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const isTouch=matchMedia('(hover:none)').matches;
const CHAPTERS=[
 {id:'hosh',tab:'West Side Story · Harbour',year:'2024',logo:'logo-hosh-wss-white.png',title:'West Side Story',
  roles:['Moose','Understudy Bernardo'],co:'Handa Opera on Sydney Harbour · Opera Australia',
  video:'video-hosh3.mp4',poster:'video-hosh3.jpg',vcap:'West Side Story on Sydney Harbour',
  text:'An outdoor stage built over the water, with the Opera House and the Harbour Bridge as the backdrop. I played Moose and understudied Bernardo, the leader of the Sharks.',
  facts:[['Role','Moose'],['Cover','Bernardo'],['Venue','Sydney Harbour'],['Company','Opera Australia']],
  media:[
   {t:'v',src:'video-bernardo.mp4',poster:'video-bernardo.jpg',cap:'As Bernardo',sub:'Footage: @sydneyweekender'},
   {src:'img-hosh-poster.jpg',cap:'The West Side Story poster, signed by the cast'},
   {src:'img-hosh-stage-day.jpg',cap:'The stage on Sydney Harbour'},
   {src:'img-hosh-gym.jpg',cap:'The Dance at the Gym'},
   {src:'img-hosh-stage-night.jpg',cap:'The stage at night'},
   {src:'img-hosh-fireworks.jpg',cap:'Fireworks just before interval'}]},
 {id:'tour',tab:'West Side Story · Tour',year:'2019–21',logo:'logo-wss-tour-black.png',inv:1,title:'West Side Story',
  roles:['Bernardo','Pepe · u/s Bernardo'],co:'Aus/NZ International Tour · GWB, Opera Australia',
  video:'video-tour-mambo2.mp4',poster:'video-tour-mambo2.jpg',vcap:'Media call, as Pepe',
  text:'The international tour across Australia and New Zealand. I joined in 2019 as Pepe, understudying Bernardo, and in 2021 I took on Bernardo himself, leading the Sharks.',
  facts:[['2021','Bernardo'],['2019','Pepe, u/s Bernardo'],['Territory','Australia & New Zealand'],['Producers','GWB, Opera Australia']],
  media:[
   {src:'img-tour-sharks.jpg',cap:'With my Sharks in “Tonight”'},
   {src:'img-tour-tonight.jpg',cap:'As Bernardo in “Tonight”'},
   {src:'img-tour-bernardo.jpg',cap:'Bernardo, West Side Story'},
   {src:'img-tour-quote.jpg',cap:'Press: “The talent of the cast is exemplary”'}]},
 {id:'uss',tab:'Universal Studios',year:'',logo:'logo-uss.png',title:'Universal Studios Singapore',
  roles:['Singer & dancer'],co:'Resorts World Sentosa, Singapore',
  text:'Singing and dancing in the theme park’s live shows at Resorts World Sentosa, performing for visitors from all over the world.',
  facts:[['Role','Singer & dancer'],['Venue','Resorts World Sentosa'],['Country','Singapore']],media:[]},
 {id:'celeb',tab:'Celebrity Cruises',year:'',logo:'logo-celebrity.svg',inv:1,title:'Celebrity Solstice',
  roles:['Singer & dancer'],co:'Celebrity Cruises',
  video:'video-celeb-dance.mp4',poster:'video-celeb-dance.jpg',vcap:'Broken Strings · dance break',
  text:'Three full production shows in the ship’s theatre: Amade, Rock City and Broken Strings. That’s me in the centre of the Broken Strings dance break.',
  facts:[['Shows','Amade, Rock City, Broken Strings'],['Ship','Celebrity Solstice'],['Role','Singer & dancer']],
  media:[
   {src:'img-celeb-rockcity.jpg',cap:'Rock City, Celebrity Solstice'},
   {src:'img-celeb-rockcity2.jpg',cap:'Rock City, Celebrity Solstice'},
   {src:'img-celeb-brokenstrings.jpg',cap:'Broken Strings, Celebrity Solstice'}]}
];
const SHIPS=[
 {ship:'Spectrum of the Seas',role:'Reverb',years:'2025–2026',shows:'The Effectors, Showgirl',latest:1},
 {ship:'Ovation of the Seas',role:'Singer (B3)',shows:'The Beautiful Dream, Live Love Legs'},
 {ship:'Quantum of the Seas',role:'Singer (B1)',shows:'Sequins and Feathers, Sonic Odyssey'},
 {ship:'Quantum of the Seas',role:'Singer (B3)',shows:'Sequins and Feathers, Sonic Odyssey'},
 {ship:'Ovation of the Seas',role:'Singer (B3)',shows:'The Beautiful Dream, Live Love Legs'}];
const SCREEN=[
 {t:'Paramount',k:'Presenter',logo:'logo-paramount.svg',inv:1,video:'video-paramount.mp4',poster:'video-paramount.jpg',
  p:'Presenting for Paramount Australia (ParamountAU) on Teenage Mutant Ninja Turtles: Mutant Mayhem, on set with the Turtles themselves.',
  mini:[['img-paramount-turtles.jpg','With the Turtles on set'],['img-paramount-turtles2.jpg','On set with the Turtles'],['img-paramount-set.jpg','The studio']]},
 {t:'Ladbrokes',k:'Featured extra',logo:'logo-ladbrokes-white.png',video:'video-ladbrokes2.mp4',poster:'video-ladbrokes2.jpg',
  p:'Featured as the greyhound in the Ladbrokes TV commercial starring Mark Wahlberg.'},
 {t:'CC’s',k:'Hero',logo:'logo-ccs-white.png',video:'video-ccs.mp4',poster:'video-ccs.jpg',
  p:'The hero of the CC’s TV commercial for Snackbrands: the packet, the chip burst and all the close-ups.'},
 {t:'I’m A Celebrity…',k:'Dancer',logo:'logo-imaceleb.jpg',badge:1,poster:'video-imaceleb.jpg',video:'video-imaceleb.mp4',
  p:'Dancer in the TV commercial for I’m A Celebrity… Get Me Out Of Here!, ITV Studios for Channel 10: the red-carpet kicks, the eyeball-fork circle from above and the lawn line.'},
 {t:'H&R Block',k:'Hero',logo:'logo-hrblock.svg',inv:1,poster:'video-hrb.jpg',video:'video-hrb.mp4',
  p:'The hero of H&R Block’s File Free student TV commercial: the library, the late-night tax question and the iPad.'},
 {t:'Aquarius',k:'Featured dancer',logo:'logo-aquarius.svg',inv:1,poster:'video-aquarius.jpg',video:'video-aquarius.mp4',
  p:'Dancing in the Aquarius “All Day Long” TV commercial for Coca-Cola Japan, shot in Sydney: the street dance and the balloon finale. I’m on the right in the red shirt and braces.'},
 {t:'Toyota RAV4',k:'Featured extra',logo:'logo-toyota.svg',inv:1,poster:'video-rav4.jpg',video:'video-rav4.mp4',
  p:'In the Toyota RAV4 “Love for Impossible” TV commercial: running the dunes and in the final group pose behind the car, in the yellow shirt and cap.'},
 {t:'KFC',k:'Featured extra',logo:'logo-kfc.svg',inv:1,poster:'video-kfc.jpg',video:'video-kfc.mp4',
  p:'In the KFC “New Girl” TV commercial: that’s me in the back of the crowd in the sombrero, and again in the final shot.'}];
const REEL=[
 {g:'Theatre',items:[
  {src:'hosh3',t:'Sydney Harbour',s:'West Side Story · 2024'},
  {src:'bernardo',t:'Bernardo',s:'Footage: @sydneyweekender'},
  {src:'tour-mambo2',t:'The tour',s:'Media call · as Pepe'}]},
 {g:'Cruise shows',items:[
  {src:'celeb-dance',t:'Broken Strings',s:'Celebrity Solstice'}]},
 {g:'Presenting',items:[
  {src:'paramount',t:'Paramount',s:'Movie Scoop presenter'}]},
 {g:'TVCs',still:1,items:[
  {src:'hrb',t:'H&R Block',s:'Hero'},
  {src:'imaceleb',t:'I’m A Celebrity…',s:'Dancer'},
  {src:'kfc',t:'KFC',s:'Featured extra'},
  {src:'aquarius',t:'Aquarius',s:'Featured dancer'},
  {src:'rav4',t:'Toyota RAV4',s:'Featured extra'},
  {src:'ccs',t:'CC’s',s:'Hero'},
  {src:'ladbrokes2',t:'Ladbrokes',s:'Featured extra'}]}];
const CREDITS=[
 ['West Side Story — Handa Opera on Sydney Harbour','Moose · u/s Bernardo','Opera Australia · 2024','Stage'],
 ['West Side Story — Aus/NZ International Tour','Bernardo','GWB, Opera Australia · 2021','Stage'],
 ['West Side Story — Aus/NZ International Tour','Pepe · u/s Bernardo','GWB, Opera Australia · 2019','Stage'],
 ['The Original Grease','Kenickie','Squabbalogic','Stage'],
 ['Bring It On: The Musical (Sydney & Queensland)','Cameron','Supply Evolution','Stage'],
 ['Universal Studios Singapore','Singer & dancer','Resorts World Sentosa','Stage'],
 ['The Effectors, Showgirl','Reverb','Royal Caribbean · Spectrum of the Seas · 2025–26','Stage'],
 ['The Beautiful Dream, Live Love Legs','Singer (B3)','Royal Caribbean · Ovation of the Seas','Stage'],
 ['Sequins and Feathers, Sonic Odyssey','Singer (B1)','Royal Caribbean · Quantum of the Seas','Stage'],
 ['Sequins and Feathers, Sonic Odyssey','Singer (B3)','Royal Caribbean · Quantum of the Seas','Stage'],
 ['The Beautiful Dream, Live Love Legs','Singer (B3)','Royal Caribbean · Ovation of the Seas','Stage'],
 ['Amade, Rock City, Broken Strings','Singer & dancer','Celebrity Cruises · Celebrity Solstice','Stage'],
 ['Teenage Mutant Ninja Turtles: Mutant Mayhem','Presenter','Paramount (ParamountAU)','Screen'],
 ['Ladbrokes TVC, with Mark Wahlberg','Featured extra','Ladbrokes','Screen'],
 ['CC’s TVC','Hero','Snackbrands','Screen'],
 ['I’m A Celebrity… Get Me Out Of Here! TVC','Dancer','ITV Studios · Channel 10','Screen'],
 ['Pieces of Her','Club dancer','Netflix','Screen'],
 ['H&R Block TVC','Hero','H&R Block','Screen'],
 ['KFC “New Girl” TVC','Featured extra','KFC','Screen'],
 ['Aquarius “All Day Long” TVC','Featured dancer','Coca-Cola Japan','Screen'],
 ['Toyota RAV4 TVC','Featured extra','Toyota','Screen'],
 ['Dulux and more','TVCs','Various','Screen'],
 ['Certificate III in Theatre and Screen','Graduate','ACTT','Training'],
 ['Certificate IV in Dance','Graduate','Village Nation (Village on Broadway)','Training'],
 ['Diploma of Musical Theatre','Graduate','Village Nation (Village on Broadway)','Training']];
const THEATRE_LOGOS=[['logo-hosh-wss-white.png','West Side Story, Handa Opera on Sydney Harbour'],['logo-wss-tour-black.png','West Side Story, Aus/NZ tour'],['logo-uss.png','Universal Studios Singapore',1],['logo-celebrity.svg','Celebrity Cruises'],['logo-royal-caribbean.svg','Royal Caribbean International']];
const SCREEN_LOGOS=[['logo-paramount.svg','Paramount'],['logo-netflix.svg','Netflix'],['logo-imaceleb.jpg','I’m A Celebrity… Get Me Out Of Here!',1],['logo-network10.svg','Network 10'],['logo-itv-studios.svg','ITV Studios'],['logo-hrblock.svg','H&R Block'],['logo-kfc.svg','KFC'],['logo-toyota.svg','Toyota'],['logo-aquarius.svg','Aquarius'],['logo-ladbrokes-white.png','Ladbrokes'],['logo-ccs-white.png','CC’s']];
/* lightbox */
const groups={};let cur=null,ci=0;
function reg(g,item){(groups[g]=groups[g]||[]).push(item);return groups[g].length-1}
function openLB(g,i){cur=g;ci=i;$('#lb').classList.add('on');document.body.style.overflow='hidden';showLB()}
function showLB(){$$('video').forEach(v=>{if(!v.closest('#lb'))v.pause()});const it=groups[cur][ci],box=$('#lbBox');box.innerHTML=it.t==='v'?`<video src="${it.src}" poster="${it.poster||''}" controls autoplay playsinline></video>`:`<img src="${it.src}" alt="">`;
 $('#lbCap').innerHTML=`${it.cap||''}${it.sub?`<small>${it.sub}</small>`:''}`;$('#lbCount').textContent=`${ci+1} / ${groups[cur].length}`;
 const lv=$('video',box);if(lv){lv.muted=false;lv.volume=1;lv.play().catch(()=>{lv.muted=true;lv.play()})}
 const many=groups[cur].length>1;$('#lbP').style.display=$('#lbN').style.display=many?'':'none'}
function closeLB(){$('#lb').classList.remove('on');$('#lbBox').innerHTML='';document.body.style.overflow=''}
function step(d){const n=groups[cur].length;ci=(ci+d+n)%n;showLB()}
$('#lbX').onclick=closeLB;$('#lbP').onclick=()=>step(-1);$('#lbN').onclick=()=>step(1);
$('#lb').addEventListener('click',e=>{if(e.target.id==='lb')closeLB()});
addEventListener('keydown',e=>{if(!$('#lb').classList.contains('on'))return;if(e.key==='Escape')closeLB();if(e.key==='ArrowRight')step(1);if(e.key==='ArrowLeft')step(-1)});
let sx=0;$('#lb').addEventListener('touchstart',e=>sx=e.touches[0].clientX,{passive:true});
$('#lb').addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-sx;if(Math.abs(dx)>50)step(dx<0?1:-1)});
function bindLB(el,g,item){const i=reg(g,item);el.addEventListener('click',()=>openLB(g,i))}
const hoverPlay=(c,v)=>{if(!isTouch){c.addEventListener('mouseenter',()=>v.play().catch(()=>{}));c.addEventListener('mouseleave',()=>v.pause())}};
/* build */
$('#yr').textContent=new Date().getFullYear();
const logoRow=L=>{const h=L.map(([src,alt,badge])=>`<img src="${src}" alt="${alt}" title="${alt}" class="${badge?'badge':''}" loading="lazy">`).join('');return h+h+h+h};
$('#trackTheatre').innerHTML=logoRow(THEATRE_LOGOS);$('#trackScreen').innerHTML=logoRow(SCREEN_LOGOS);
$$('.trio button').forEach(b=>bindLB(b,'about',{src:b.dataset.src,cap:b.dataset.cap}));
$('#reelGrid').innerHTML=REEL.map(G=>`<div class="rgroup rv"><div class="rhead"><h3 class="disp">${G.g}</h3><span>${G.items.length} ${G.items.length>1?'clips':'clip'}</span></div><div class="rgrid">${G.items.map(r=>`<div class="vcard" data-src="${r.src}">${G.still?`<img src="video-${r.src}.jpg" alt="${r.t}" loading="lazy">`:`<video muted loop playsinline preload="none" poster="video-${r.src}.jpg" src="video-${r.src}.mp4"></video>`}<div class="play">▶</div><div class="cap"><b>${r.t}</b><small>${r.s}</small></div></div>`).join('')}</div></div>`).join('');
$$('#reelGrid .vcard').forEach(c=>{const r=REEL.flatMap(G=>G.items).find(x=>x.src===c.dataset.src);bindLB(c,'reel',{t:'v',src:`video-${r.src}.mp4`,poster:`video-${r.src}.jpg`,cap:r.t,sub:r.s});const v=$('video',c);if(v)hoverPlay(c,v)});
$('#tabs').innerHTML=CHAPTERS.map((c,i)=>`<button class="tab ${i?'':'on'}" data-i="${i}">${c.tab}${c.year?`<span class="y">${c.year}</span>`:''}</button>`).join('');
$('#chapters').innerHTML=CHAPTERS.map((c,i)=>`<article class="chapter ${i?'':'on'}" id="ch-${c.id}"><div>${c.video?`<div class="stagev"><video muted loop playsinline ${i?'':'autoplay'} preload="metadata" poster="${c.poster}" src="${c.video}"></video><span class="expand">⤢ Expand</span></div>`
 :`<div class="stagev" style="display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,#2a2330,#0f0d12);cursor:default"><img src="${c.logo}" alt="${c.title}" style="max-width:55%;max-height:60%"></div>`}
 ${c.media.length?`<div class="thumbs">${c.media.map((m,j)=>`<button data-n="${m.t==='v'?'▶ video':j+1}"><img src="${m.poster||m.src}" alt="${m.cap}" loading="lazy"></button>`).join('')}</div>`:''}</div>
 <div class="info"><img class="logo" src="${c.logo}" alt="" style="${c.inv?'filter:brightness(0) invert(1)':''}"><h3 class="disp">${c.title}</h3>${c.roles.map((r,k)=>`<span class="role ${k?'alt':''}">${r}</span>`).join('')}
 <div class="co">${c.co}</div><p>${c.text}</p><ul class="facts">${c.facts.map(f=>`<li><span>${f[0]}</span><span>${f[1]}</span></li>`).join('')}</ul></div></article>`).join('');
CHAPTERS.forEach(c=>{const art=$('#ch-'+c.id),g='ch-'+c.id;if(c.video)bindLB($('.stagev',art),g,{t:'v',src:c.video,poster:c.poster,cap:c.vcap});$$('.thumbs button',art).forEach((b,j)=>bindLB(b,g,{...c.media[j]}))});
$$('#tabs .tab').forEach(t=>t.onclick=()=>{$$('#tabs .tab').forEach(x=>x.classList.toggle('on',x===t));
 $$('.chapter').forEach((a,i)=>{const on=i==t.dataset.i;a.classList.toggle('on',on);const v=$('video',a);if(v){on?v.play().catch(()=>{}):v.pause()}});
 t.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'})});
$('#voyage').innerHTML=SHIPS.map((s,i)=>`<div class="stop ${i?'':'open'}"><div class="h"><span><b>${s.ship}</b>${s.latest?'<span class="badge">Latest</span>':''}</span><small>${s.role}${s.years?' · '+s.years:''}</small></div><div class="d"><div>Production shows: <b>${s.shows}</b></div></div></div>`).join('');
$$('.stop').forEach(s=>s.onclick=()=>s.classList.toggle('open'));
$('#screenGrid').innerHTML=SCREEN.map(s=>`<div class="sc rv"><div class="m"><video muted loop playsinline preload="none" poster="${s.poster}" src="${s.video}"></video><div class="play" style="position:absolute;top:12px;right:12px;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:rgba(227,49,43,.9)">▶</div></div>
 <div class="b"><div class="k"><h4>${s.t}</h4>${s.logo?`<img src="${s.logo}" alt="" class="${s.badge?'badge':''}" style="${s.inv?'filter:brightness(0) invert(1)':''}">`:''}</div><span class="pill">${s.k}</span><p>${s.p}</p>
 ${s.mini?`<div class="mini">${s.mini.map(m=>`<button><img src="${m[0]}" alt="${m[1]}" loading="lazy"></button>`).join('')}</div>`:''}</div></div>`).join('');
$$('#screenGrid .sc').forEach((c,i)=>{const s=SCREEN[i],g='sc'+i,m=$('.m',c);bindLB(m,g,{t:'v',src:s.video,poster:s.poster,cap:s.t,sub:s.k});
 (s.mini||[]).forEach((mm,j)=>bindLB($$('.mini button',c)[j],g,{src:mm[0],cap:mm[1]}));hoverPlay(c,$('video',m))});
/* credits */
const TYPES=['All','Stage','Screen','Training'];let ft='All';
$('#cfilter').innerHTML=TYPES.map((t,i)=>`<button class="tab ${i?'':'on'}" data-t="${t}">${t}<span class="y">${t==='All'?CREDITS.length:CREDITS.filter(c=>c[3]===t).length}</span></button>`).join('');
function drawCredits(){const q=$('#csearch').value.trim().toLowerCase();
 const rows=CREDITS.filter(c=>(ft==='All'||c[3]===ft)&&(!q||c.join(' ').toLowerCase().includes(q)));
 $('#ctable').innerHTML=`<div class="crow hd"><span>Production</span><span>Role</span><span>Company</span><span style="text-align:right">Type</span></div>`+
 (rows.length?rows.map(c=>`<div class="crow"><span class="p">${c[0]}</span><span class="ro">${c[1]}</span><span class="c">${c[2]}</span><span class="t">${c[3]}</span></div>`).join(''):`<div class="empty">No credits match that search.</div>`)}
$$('#cfilter .tab').forEach(t=>t.onclick=()=>{ft=t.dataset.t;$$('#cfilter .tab').forEach(x=>x.classList.toggle('on',x===t));drawCredits()});
$('#csearch').oninput=drawCredits;drawCredits();
/* motion */
const ROLES=['Singer','Dancer','Actor','Presenter','Bernardo','Moose','Reverb'];let ri=0;
setInterval(()=>{const el=$('#role'),w=el.textContent,nx=ROLES[ri=(ri+1)%ROLES.length];let k=w.length;
 const del=setInterval(()=>{el.textContent=w.slice(0,--k);if(k<=0){clearInterval(del);let a=0;const ty=setInterval(()=>{el.textContent=nx.slice(0,++a);if(a>=nx.length)clearInterval(ty)},70)}},40)},2600);
const hero=$('.hero');hero.addEventListener('pointermove',e=>{const r=hero.getBoundingClientRect();$('#spot').style.setProperty('--x',(e.clientX-r.left)+'px');$('#spot').style.setProperty('--y',(e.clientY-r.top)+'px')});
const secs=$$('section[id]');
addEventListener('scroll',()=>{const h=document.documentElement;$('#progress').style.width=(h.scrollTop/(h.scrollHeight-innerHeight))*100+'%';
 $('#nav').classList.toggle('solid',scrollY>40);let id='';secs.forEach(s=>{if(s.getBoundingClientRect().top<innerHeight*.4)id=s.id});
 $$('#links a').forEach(a=>a.classList.toggle('on',a.getAttribute('href')==='#'+id))},{passive:true});
$('#burger').onclick=()=>$('#links').classList.toggle('open');$$('#links a').forEach(a=>a.addEventListener('click',()=>$('#links').classList.remove('open')));
const io=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;e.target.classList.add('in');
 $$('[data-count]',e.target).forEach(n=>{if(n.done)return;n.done=1;const to=+n.dataset.count;let v=0;const t=setInterval(()=>{n.textContent=++v;if(v>=to)clearInterval(t)},120)});io.unobserve(e.target)}),{threshold:.12});
$$('.rv').forEach(el=>io.observe(el));
if(isTouch){const vo=new IntersectionObserver(es=>es.forEach(e=>{const v=e.target;e.isIntersecting?v.play().catch(()=>{}):v.pause()}),{threshold:.6});$$('.vcard video,.sc video').forEach(v=>{v.preload='metadata';vo.observe(v)})}
$('#copy').onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText('temujin.tera@gmail.com');const t=$('#toast');t.classList.add('on');setTimeout(()=>t.classList.remove('on'),1600)};
