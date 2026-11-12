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
