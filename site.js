/* TrulyPlaced content pages: the homepage's own scripts for the menu, the theme switch and the footer. */
(function(){
  var y=document.getElementById('yr'); if(y) y.textContent=new Date().getFullYear();
  var bar=document.getElementById('tpBar'); if(bar){ var on=function(){ bar.classList.toggle('scrolled', window.scrollY>36); }; on(); addEventListener('scroll', on, {passive:true}); }
  // mobile menu
  var burger = document.getElementById('burger'), mobnav = document.getElementById('mobnav');
  function setMenu(open){
    if(!burger || !mobnav) return;
    mobnav.hidden = !open;
    mobnav.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  if (burger && mobnav){
    burger.addEventListener('click', function(e){
      e.stopPropagation();
      setMenu(mobnav.hidden);
    });
    // a link closes it; the browser still handles the jump
    mobnav.addEventListener('click', function(e){ if(e.target.closest('a')) setMenu(false); });
    document.addEventListener('click', function(e){
      if(!mobnav.hidden && !mobnav.contains(e.target) && e.target!==burger) setMenu(false);
    });
    document.addEventListener('keydown', function(e){ if(e.key==='Escape') setMenu(false); });
    // leaving mobile width resets it, so the desktop nav is never hidden behind state
    var mq = window.matchMedia('(min-width:901px)');
    (mq.addEventListener ? mq.addEventListener.bind(mq,'change') : mq.addListener.bind(mq))(function(){ setMenu(false); });
  }
})();
/* footer light: wide squares that touch, lit by a soft blue glow across the middle (strongest behind the name,
   falling to black at every edge), each square its own brightness, with a fine halftone grain only where there is
   light. Drawn once per size, when the footer comes near. */
(function(){
  var cv=document.querySelector('.ft3-bg');if(!cv||!cv.getContext)return;
  var ctx=cv.getContext('2d'),drawn='';
  function rnd(i){var x=Math.sin(i*127.1+311.7)*43758.5453;return x-Math.floor(x)}
  function draw(){
    var w=cv.clientWidth,h=cv.clientHeight;if(!w||!h)return;var dk=document.documentElement.getAttribute('data-theme')==='dark',key=w+'x'+h+dk;if(key===drawn)return;drawn=key;
    var BG=dk?'3,3,4':'245,247,251';
    var dpr=Math.min(2,window.devicePixelRatio||1);cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='rgb('+BG+')';ctx.fillRect(0,0,w,h);
    var word=document.querySelector('.ft3-word'),fr=cv.getBoundingClientRect(),wr=word?word.getBoundingClientRect():null;
    var cy=wr?(wr.top-fr.top)+wr.height*.42:h*.55,bh=Math.max(120,wr?wr.height*1.15:h*.25);
    var cw=Math.max(64,Math.round(w/16)),ch=Math.round(cw*1.25),cols=Math.ceil(w/cw)+1,rows=Math.ceil(h/ch)+1,oy=cy-Math.round(cy/ch)*ch-ch/2;
    function L(x,y){var dy=(y-cy)/bh,dxn=(x-w*.56)/(w*.58);return Math.exp(-dy*dy*1.6)*Math.max(0,1-dxn*dxn)}
    for(var r=0;r<rows;r++)for(var c=0;c<cols;c++){
      var x=c*cw,y=oy+r*ch,k=rnd(r*131+c*7),l=L(x+cw/2,y+ch/2)*(k<.3?.06:.35+.75*k);
      if(l<.015)continue;
      var g=ctx.createLinearGradient(0,y,0,y+ch);
      if(dk){g.addColorStop(0,'rgba(9,56,213,'+(l*.22).toFixed(3)+')');g.addColorStop(.5,'rgba(36,128,255,'+(l*.62).toFixed(3)+')');g.addColorStop(1,'rgba(9,56,213,'+(l*.18).toFixed(3)+')')}
      else{g.addColorStop(0,'rgba(102,160,255,'+(l*.1).toFixed(3)+')');g.addColorStop(.5,'rgba(60,120,255,'+(l*.26).toFixed(3)+')');g.addColorStop(1,'rgba(102,160,255,'+(l*.08).toFixed(3)+')')}
      ctx.fillStyle=g;ctx.fillRect(x,y,cw,ch);
    }
    // a soft glow behind the name (no hard line)
    var gl=ctx.createRadialGradient(w*.56,cy,0,w*.56,cy,w*.55);
    gl.addColorStop(0,dk?'rgba(80,160,255,.16)':'rgba(120,175,255,.22)');gl.addColorStop(.5,dk?'rgba(40,110,255,.06)':'rgba(140,190,255,.08)');gl.addColorStop(1,'rgba(40,110,255,0)');
    ctx.save();ctx.translate(0,cy);ctx.scale(1,.28);ctx.translate(0,-cy);ctx.fillStyle=gl;ctx.fillRect(0,cy-w*.6,w,w*1.2);ctx.restore();
    // halftone grain inside the light
    ctx.globalCompositeOperation=dk?'lighter':'source-over';
    for(var yy=Math.max(0,cy-bh*1.6);yy<Math.min(h,cy+bh*1.6);yy+=3)for(var xx=(yy/3%2)*1.5;xx<w;xx+=3){
      var v=L(xx,yy);if(v<.05)continue;var q=rnd(xx*.71+yy*13.3);if(q>v*.8)continue;
      ctx.fillStyle=dk?'rgba(150,195,255,'+(.05+.12*v).toFixed(3)+')':'rgba(9,56,213,'+(.05+.14*v).toFixed(3)+')';ctx.fillRect(xx,yy,1,1)}
    ctx.globalCompositeOperation='source-over';
    // fall to black at every edge so the words sit on calm ground
    var v1=ctx.createLinearGradient(0,0,0,h);v1.addColorStop(0,'rgba('+BG+',.95)');v1.addColorStop(w<640?.66:.25,'rgba('+BG+',0)');v1.addColorStop(.78,'rgba('+BG+',0)');v1.addColorStop(1,'rgba('+BG+',.96)');
    ctx.fillStyle=v1;ctx.fillRect(0,0,w,h);
    var v2=ctx.createLinearGradient(0,0,w,0);v2.addColorStop(0,'rgba('+BG+',.7)');v2.addColorStop(.14,'rgba('+BG+',0)');v2.addColorStop(.86,'rgba('+BG+',0)');v2.addColorStop(1,'rgba('+BG+',.7)');
    ctx.fillStyle=v2;ctx.fillRect(0,0,w,h);
  }
  var started=false;
  function start(){if(started)return;started=true;draw();new MutationObserver(draw).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});var t;addEventListener('resize',function(){clearTimeout(t);t=setTimeout(draw,150)},{passive:true})}
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){if(es[0].isIntersecting){start();io.disconnect()}},{rootMargin:'600px'});io.observe(cv);(function(f){var go=function(){(window.requestIdleCallback||function(g){setTimeout(g,1500)})(f,{timeout:6000})};if(document.readyState==='complete')go();else addEventListener('load',go,{once:true})})(function(){start();io.disconnect()})}else start();
})();
/* sun / moon theme toggle */
(function(){
  var root=document.documentElement,btns=document.querySelectorAll("#tpBar [data-set-theme]"),meta=document.querySelector('meta[name="theme-color"]');
  function apply(t){
    if(t==="dark")root.setAttribute("data-theme","dark");else root.removeAttribute("data-theme");
    btns.forEach(function(b){b.setAttribute("aria-pressed",String(b.getAttribute("data-set-theme")===t))});
    if(meta)meta.setAttribute("content",t==="dark"?"#0b0e1a":"#0938d5");
  }
  apply(root.getAttribute("data-theme")==="dark"?"dark":"light");
  btns.forEach(function(b){b.addEventListener("click",function(){var t=b.getAttribute("data-set-theme");apply(t);try{localStorage.setItem("tp-theme",t)}catch(e){}})});
})();

/* The bar's name: shown once the page's own big "TrulyPlaced" (the homepage's .cx-word) is out of view, hidden while
   it's in view; on pages without one, shown as the page opens. */
(function(){
  var bar=document.getElementById('tpBar');if(!bar)return;
  var word=document.querySelector('.cx-word');
  if(!word||!('IntersectionObserver' in window)){requestAnimationFrame(function(){requestAnimationFrame(function(){bar.classList.add('cb-named')})});return}
  new IntersectionObserver(function(es){bar.classList.toggle('cb-named',!es[0].isIntersecting)},{rootMargin:'-72px 0px 0px 0px'}).observe(word);
})();

/* blog: the phone and tablet "Try it free" card (styles at the end of site.css). Shown once the post's photo or the
   blog home's title has scrolled away; it stays up past the article's own "Get started free" button and steps
   aside only for the closing card and the footer, while the menu is open, and for the rest of the visit once closed. */
(function(){try{
  if(!document.querySelector('main.blg')||!('IntersectionObserver' in window))return;
  // only with its styles: if site.css is an older copy (a cache, or not uploaded yet), the card is never built, so its
  // parts can't show unstyled. With the styles, a .bcta is fixed on phones and tablets and hidden on wider screens.
  var probe=document.createElement('i');probe.className='bcta';document.body.appendChild(probe);
  var pcs=getComputedStyle(probe),styled=pcs.position==='fixed'||pcs.display==='none';probe.remove();if(!styled)return;
  try{if(sessionStorage.getItem('tp-bcta')==='x')return}catch(e){}
  var pin='<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="116" fill="#fff"/><path d="M256 410C168 314 138 278 138 206c0-64 53-112 118-112s118 48 118 112c0 72-30 108-118 204z" fill="#0938D5"/><path d="M205 200l37 36 76-88" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var job=function(n,p){return '<span class="bcta-job j'+n+'"><i></i><span></span><em style="--p:'+p+'"><b>'+p+'</b></em></span>'};
  var bar=document.createElement('aside');bar.className='bcta';bar.setAttribute('aria-label','Try TrulyPlaced');bar.setAttribute('aria-hidden','true');
  bar.innerHTML='<div class="bcta-top"><span class="bcta-tx"><span class="bcta-brand">'+pin+'TrulyPlaced</span><b>Put your job hunt on Autopilot</b><span class="bcta-sub">even while you sleep</span></span>'+
    '<span class="bcta-art" aria-hidden="true">'+job(1,87)+job(2,91)+job(3,96)+'</span></div>'+
    '<a class="bcta-go" href="https://app.trulyplaced.com" tabindex="-1">Try it free<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>'+
    '<button class="bcta-x" type="button" aria-label="Close" tabindex="-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
  document.body.appendChild(bar);
  var go=bar.querySelector('.bcta-go'),x=bar.querySelector('.bcta-x'),mob=document.getElementById('mobnav');
  var past=false,busy={},off=false;
  function set(){var near=false;for(var k in busy)if(busy[k])near=true;
    var on=past&&!near&&!off&&!(mob&&!mob.hidden);bar.classList.toggle('on',on);bar.setAttribute('aria-hidden',String(!on));go.tabIndex=x.tabIndex=on?0:-1}
  var start=document.querySelector('.blg-cv')||document.querySelector('.blg-hd')||document.querySelector('.blg-ph');
  if(start)new IntersectionObserver(function(es){var e=es[0];past=!e.isIntersecting&&e.boundingClientRect.top<0;set()}).observe(start);else past=true;
  var io=new IntersectionObserver(function(es){es.forEach(function(e){busy[e.target.__bk]=e.isIntersecting});set()},{rootMargin:'0px 0px -240px 0px'});   // counts once it rises above the card's own height, so the card slides away to reveal it
  [].forEach.call(document.querySelectorAll('.blg-end, footer.ft3'),function(el,i){el.__bk='k'+i;io.observe(el)});
  if(mob)new MutationObserver(set).observe(mob,{attributes:true,attributeFilter:['hidden']});
  x.addEventListener('click',function(){off=true;set();try{sessionStorage.setItem('tp-bcta','x')}catch(e){}});
  set();
}catch(e){}})();
