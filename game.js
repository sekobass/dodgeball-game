'use strict';
(() => {
  const canvas = document.querySelector('#court'), ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  const W = canvas.width, H = canvas.height, R = 19, margin = 32;
  // Unlimited match duration; projectile speed still increases during play.
  let ballIdle = 0;
  const baseSpeed = () => Number($('speedSetting').value);
  const speedMultiplier = () => time < 30 ? 1 : time < 60 ? 1.25 : time < 90 ? 1.5 : 1.7;
  const currentBallSpeed = () => Math.round(baseSpeed() * speedMultiplier());
  const keys = new Set();
  let state = 'ready', players = [], ball, controlled, effects = [], time = 0, last = 0;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const living = team => players.filter(p => p.team === team && p.alive);
  function reset() {
    players = [];
    for (let team = 0; team < 2; team++) for (let i = 0; i < 3; i++) players.push({team, number:i+1, x:team ? 735 : 225, y:140+i*140, alive:true, wait:0, phase:i*2+team});
    controlled = players[0];
    ball = {x:300, y:280, vx:0, vy:0, owner:null, team:null, flight:0, lock:0, trail:[]};
    effects = []; time = 0; ballIdle = 0; keys.clear(); updateScore(); updateSpeedDisplay();
  }
  function updateScore() { $('blueCount').textContent = living(0).length; $('redCount').textContent = living(1).length; }
  function updateSpeedDisplay() {
    $('ballSpeed').textContent = `${currentBallSpeed()} (${time < 30 ? '通常' : time < 60 ? '加速1' : time < 90 ? '加速2' : '最高速'})`;
  }
  function start() { reset(); state='playing'; $('overlay').hidden=true; $('status').textContent='ボールをひろって、Spaceで投げよう！'; last=performance.now(); canvas.focus(); }
  function finish(team) {
    state='ended'; keys.clear(); $('overlay').hidden=false;
    $('message').textContent=team===0?'やったね！ あなたの勝ち！':'CPUの勝ち！ もう一度ちょうせん！';
    $('detail').textContent='よける動きと、ボールをひろうタイミングがコツ！'; $('start').textContent='もう一度あそぶ';
    $('status').textContent=team===0?'青チームの勝利！':'赤チームの勝利！';
  }
  function throwBall(p) {
    if (ball.owner!==p || state!=='playing') return;
    const target=living(1-p.team).sort((a,b)=>distance(p,a)-distance(p,b))[0];
    if (!target) return;
    const angle=Math.atan2(target.y-p.y,target.x-p.x);
    ball.owner=null; ball.team=p.team; ball.flight=1.65; ball.lock=.2;
    ball.x=p.x+Math.cos(angle)*(R+12); ball.y=p.y+Math.sin(angle)*(R+12);
    const speed=currentBallSpeed(); ball.vx=Math.cos(angle)*speed; ball.vy=Math.sin(angle)*speed;
    p.wait=.8; if(p===controlled) $('status').textContent='ナイススロー！ 次のボールにそなえよう';
  }
  function move(p, dx, dy, speed, dt) {
    const length=Math.hypot(dx,dy); if(length>0){p.x+=dx/length*speed*dt;p.y+=dy/length*speed*dt;}
    p.x=clamp(p.x,p.team?W/2+R+5:margin+R,p.team?W-margin-R:W/2-R-5);
    p.y=clamp(p.y,margin+R,H-margin-R);
  }
  function update(dt) {
    time+=dt; updateSpeedDisplay();
    for (const p of players) {
      if(!p.alive) continue; p.wait=Math.max(0,p.wait-dt);
      if(p===controlled){move(p,Number(keys.has('arrowright')||keys.has('d'))-Number(keys.has('arrowleft')||keys.has('a')),Number(keys.has('arrowdown')||keys.has('s'))-Number(keys.has('arrowup')||keys.has('w')),205,dt);continue;}
      if(ball.owner===p){
        // CPU runs up to the center line and aims before throwing.
        const target=living(1-p.team).sort((a,b)=>distance(p,a)-distance(p,b))[0];
        const lineX=p.team?W/2+R+8:W/2-R-8;
        const targetY=target?clamp(target.y,margin+R,H-margin-R):p.y;
        move(p,lineX-p.x,targetY-p.y,135,dt);
        if(Math.abs(p.x-lineX)<5 && Math.abs(p.y-targetY)<45 && p.wait===0)throwBall(p);
        continue;
      }
      let tx=p.team?735:225, ty=140+(p.number-1)*140+Math.sin(time+p.phase)*42;
      const loose=!ball.owner && (ball.flight<=0 || ball.team===p.team);
      const ownHalf=p.team?ball.x>=W/2:ball.x<W/2;
      const closest=living(p.team).sort((a,b)=>distance(a,ball)-distance(b,ball))[0];
      if(loose&&ownHalf&&closest===p){tx=ball.x;ty=ball.y;}
      if(ball.flight>0&&ball.team!==p.team&&Math.abs(ball.x-p.x)<110&&Math.abs(ball.y-p.y)<40){ty=p.y+(p.y<ball.y?-95:95);}
      move(p,Math.abs(tx-p.x)>4?tx-p.x:0,Math.abs(ty-p.y)>4?ty-p.y:0,110,dt);
    }
    if(ball.owner){ballIdle=0;ball.x=ball.owner.x+(ball.owner.team?-25:25);ball.y=ball.owner.y-7;ball.trail=[];}
    else {
      ball.lock=Math.max(0,ball.lock-dt);ball.flight=Math.max(0,ball.flight-dt);
      if(ball.flight<=0){ballIdle+=dt;if(ballIdle>6){ball.x=W/2+(Math.random()<.5?-90:90);ball.y=H/2;ball.vx=ball.vy=0;ball.lock=0;ballIdle=0;$('status').textContent='ボールを中央付近に戻したよ！';}}else ballIdle=0;
      ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;
      if(ball.x<margin+9||ball.x>W-margin-9){ball.x=clamp(ball.x,margin+9,W-margin-9);ball.vx*=-.65;ball.flight=0;}
      if(ball.y<margin+9||ball.y>H-margin-9){ball.y=clamp(ball.y,margin+9,H-margin-9);ball.vy*=-.65;}
      if(ball.flight<=0){const drag=Math.exp(-3*dt);ball.vx*=drag;ball.vy*=drag;}
      ball.trail.push({x:ball.x,y:ball.y});if(ball.trail.length>10)ball.trail.shift();
      for(const p of players){
        if(!p.alive||distance(p,ball)>R+10)continue;
        if(ball.flight>0&&ball.team!==p.team){
          p.alive=false;effects.push({x:p.x,y:p.y,life:.6});ball.flight=0;ball.vx*=.3;ball.vy*=.3;ball.lock=.3;updateScore();
          if(p===controlled){controlled=living(0)[0];$('status').textContent='アウト！ 生きている味方に交代したよ';}
          if(!living(p.team).length){finish(1-p.team);return;}break;
        }
        if(ball.flight<=0&&ball.lock===0){ball.owner=p;ball.vx=ball.vy=0;p.wait=1.1+Math.random()*.6;if(p===controlled)$('status').textContent='ボールを持っているよ！ Spaceで投げよう';break;}
      }
    }
    effects=effects.filter(e=>(e.life-=dt)>0);
  }
  function draw() {
    ctx.clearRect(0,0,W,H);ctx.fillStyle='#21576a';ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#286e88';ctx.fillRect(margin,margin,W/2-margin,H-2*margin);
    ctx.fillStyle='#68556b';ctx.fillRect(W/2,margin,W/2-margin,H-2*margin);
    ctx.strokeStyle='#dfebee';ctx.lineWidth=3;ctx.strokeRect(margin,margin,W-2*margin,H-2*margin);
    ctx.beginPath();ctx.moveTo(W/2,margin);ctx.lineTo(W/2,H-margin);ctx.stroke();
    ctx.globalAlpha=.25;ctx.beginPath();ctx.arc(W/2,H/2,72,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;
    for(const p of players){if(!p.alive)continue;
      ctx.fillStyle='#102e3d55';ctx.beginPath();ctx.ellipse(p.x,p.y+18,22,9,0,0,Math.PI*2);ctx.fill();
      if(p===controlled||ball.owner===p){ctx.strokeStyle=ball.owner===p?'#ffe17b':'#9de6ff';ctx.lineWidth=4;ctx.beginPath();ctx.arc(p.x,p.y,R+7+Math.sin(time*5)*1.5,0,Math.PI*2);ctx.stroke();}
      ctx.fillStyle=p.team?'#f1767d':'#58b1ff';ctx.beginPath();ctx.arc(p.x,p.y,R,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='white';ctx.font='bold 18px system-ui';ctx.textAlign='center';ctx.fillText(p.number,p.x,p.y+6);
      if(p===controlled){ctx.font='bold 12px system-ui';ctx.fillStyle='#c6f1ff';ctx.fillText('あなた',p.x,p.y-36);}
    }
    if(ball.flight>0)ball.trail.forEach((t,i)=>{ctx.fillStyle=`rgba(255,223,121,${i/30})`;ctx.beginPath();ctx.arc(t.x,t.y,5,0,Math.PI*2);ctx.fill();});
    ctx.fillStyle='#ffe183';ctx.strokeStyle='#be782e';ctx.lineWidth=2;ctx.beginPath();ctx.arc(ball.x,ball.y,10,0,Math.PI*2);ctx.fill();ctx.stroke();
    for(const e of effects){ctx.globalAlpha=e.life/.6;ctx.strokeStyle='#ffe9ac';ctx.lineWidth=4;ctx.beginPath();ctx.arc(e.x,e.y,20+(1-e.life/.6)*50,0,Math.PI*2);ctx.stroke();ctx.font='bold 19px system-ui';ctx.fillStyle='white';ctx.fillText('アウト！',e.x,e.y-35);ctx.globalAlpha=1;}
  }
  document.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d',' '].includes(k)){if(state==='playing'){e.preventDefault();keys.add(k);if(k===' '&&!e.repeat)throwBall(controlled);}}});
  document.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur',()=>keys.clear());document.addEventListener('visibilitychange',()=>{keys.clear();last=performance.now();});
  $('speedSetting').addEventListener('change',updateSpeedDisplay);
  $('start').addEventListener('click',start);$('restart').addEventListener('click',start);
  canvas.tabIndex=0;reset();
  function frame(now){const dt=Math.min((now-last)/1000,.035);last=now;if(state==='playing')update(dt);draw();requestAnimationFrame(frame);}requestAnimationFrame(frame);
})();
