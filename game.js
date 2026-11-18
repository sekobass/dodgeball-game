'use strict';
(() => {
  const canvas = document.querySelector('#court'), ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  const W = canvas.width, H = canvas.height, R = 19, margin = 32;
  const center = W / 2;
  const leftEnd = 165, rightEnd = W - leftEnd;
  const top = margin + R, bottom = H - margin - R;
  const ballRadius = 10;
  const keys = new Set();
  let state = 'ready', players = [], ball, controlled, effects = [], time = 0, last = 0;
  let ballIdle = 0;
  const clamp = (v, a, b) => Math.max(a, Math.min(v, b));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const infield = team => players.filter(p => p.team === team && p.zone === 'infield');
  const outfield = team => players.filter(p => p.team === team && p.zone !== 'infield');
  const baseSpeed = () => Number($('speedSetting').value);
  const speedLevel = () => Math.min(12, Math.floor(time / 10));
  const speedMultiplier = () => 1 + speedLevel() / 6;
  const currentBallSpeed = () => Math.round(baseSpeed() * speedMultiplier());
  const teamName = team => team === 0 ? '青' : '赤';
  const frontX = (team, inset) => center + (team ? 1 : -1) * (R + inset);

  function horizontalBounds(p) {
    if (p.zone === 'infield') {
      return p.team ? [frontX(1, 5), rightEnd - R] : [leftEnd + R, frontX(0, 5)];
    }
    return p.team ? [margin + R, leftEnd - R] : [rightEnd + R, W - margin - R];
  }

  function nearest(point, candidates) {
    return candidates.reduce((best, p) => !best || distance(p, point) < distance(best, point) ? p : best, null);
  }

  function reset() {
    players = [];
    for (const team of [0, 1]) {
      for (let i = 0; i < 5; i++) {
        const p = {team, number:i + 1, zone:i < 3 ? 'infield' : 'starter', wait:0,
          phase:i * 2 + team, dodgeDir:0, dodgeUntil:0, catchUntil:0, nextCatch:0};
        const [minX, maxX] = horizontalBounds(p);
        p.x = i < 3 ? frontX(team, 81) : (minX + maxX) / 2;
        p.y = i < 3 ? 140 + i * 140 : 175 + (i - 3) * 210;
        players.push(p);
      }
    }
    controlled = players[0];
    ball = {x:leftEnd + 95, y:H / 2, vx:0, vy:0, owner:null, shot:null, flight:0,
      lock:0, trail:[], receivedPass:false};
    effects = [];
    time = 0;
    ballIdle = 0;
    keys.clear();
    updateScore();
    updateSpeedDisplay();
  }

  function updateScore() {
    for (const [team, color] of ['blue', 'red'].entries()) {
      $(color + 'Count').textContent = infield(team).length;
      $(color + 'OutCount').textContent = outfield(team).length;
    }
  }

  function updateSpeedDisplay() {
    const label = `${currentBallSpeed()} (${speedMultiplier().toFixed(2)}倍${speedLevel() === 12 ? '・最高速' : ''})`;
    if ($('ballSpeed').textContent !== label) $('ballSpeed').textContent = label;
  }

  function start() {
    reset();
    state = 'playing';
    $('overlay').hidden = true;
    $('status').textContent = 'ボールをひろって、Spaceで投球・Pでパス！';
    last = performance.now();
    canvas.focus();
  }

  function finish(team) {
    state = 'ended';
    keys.clear();
    $('overlay').hidden = false;
    $('message').textContent = team === 0 ? 'やったね！ あなたの勝ち！' : 'CPUの勝ち！ もう一度ちょうせん！';
    $('detail').textContent = 'よける動きと、ボールをひろうタイミングがコツ！';
    $('start').textContent = 'もう一度あそぶ';
    $('status').textContent = teamName(team) + 'チームの勝利！';
  }

  function canTarget(p, target, kind) {
    if (!players.includes(p) || !players.includes(target) || p === target) return false;
    if (kind === 'attack') return target.team !== p.team && target.zone === 'infield';
    return kind === 'pass' && target.team === p.team &&
      (p.zone === 'infield') !== (target.zone === 'infield');
  }

  function selectTarget(p, kind) {
    return nearest(p, players.filter(target => canTarget(p, target, kind)));
  }

  function throwBall(p, kind, target) {
    if (!p || ball.owner !== p || state !== 'playing') return false;
    if (!canTarget(p, target, kind)) return false;
    const [minX, maxX] = horizontalBounds(p);
    if (p.x < minX || p.x > maxX || p.y < top || p.y > bottom) return false;
    const length = distance(p, target);
    const speed = currentBallSpeed();
    ball.owner = null;
    ball.shot = {kind, from:p, target};
    ball.flight = Math.max(1.65, length / speed + .12);
    ball.x = p.x;
    ball.y = p.y;
    ball.vx = (target.x - p.x) * speed / length;
    ball.vy = (target.y - p.y) * speed / length;
    ball.trail = [];
    ball.receivedPass = false;
    p.wait = .8;
    if (p === controlled) $('status').textContent = kind === 'pass' ? '外野へパス！' : 'ナイススロー！';
    return true;
  }

  function move(p, dx, dy, speed, dt) {
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      const step = Math.min(length, speed * dt) / length;
      p.x += dx * step;
      p.y += dy * step;
    }
    const [minX, maxX] = horizontalBounds(p);
    p.x = clamp(p.x, minX, maxX);
    p.y = clamp(p.y, top, bottom);
  }

  // Predict where an attack crosses the defender's x coordinate.
  function dodgeDirection(p) {
    if (ball.shot?.kind !== 'attack' || ball.shot.from.team === p.team || Math.abs(ball.vx) < 30) return 0;
    const interceptTime = (p.x - ball.x) / ball.vx;
    if (interceptTime < -.07 || interceptTime > Math.min(1.05, ball.flight)) return 0;
    const interceptY = ball.y + ball.vy * Math.max(0, interceptTime);
    if (Math.abs(interceptY - p.y) > 95) return 0;
    if (interceptY >= p.y && p.y - top > 35) return -1;
    if (interceptY < p.y && bottom - p.y > 35) return 1;
    return bottom - p.y > p.y - top ? 1 : -1;
  }

  function evade(p, dt) {
    const direction = dodgeDirection(p);
    if (direction && time >= p.dodgeUntil) {
      p.dodgeDir = direction;
      p.dodgeUntil = time + .32;
    }
    if (ball.shot?.kind !== 'attack' || ball.shot.from.team === p.team) p.dodgeUntil = 0;
    if (time >= p.dodgeUntil) return false;
    // Retreat away from the thrower, whether the attack comes from the front or back.
    move(p, Math.sign(ball.vx) * 115, p.dodgeDir * 270, 265, dt);
    return true;
  }

  function moveControlled(p, dt) {
    const dx = Number(keys.has('arrowright') || keys.has('d')) - Number(keys.has('arrowleft') || keys.has('a'));
    const dy = Number(keys.has('arrowdown') || keys.has('s')) - Number(keys.has('arrowup') || keys.has('w'));
    move(p, dx * W, dy * W, 205, dt);
  }

  function playBall(p, dt) {
    if (p.zone === 'infield') {
      const dx = frontX(p.team, 8) - p.x;
      if (Math.abs(dx) > 2) {
        move(p, dx, 0, 175, dt);
        return;
      }
    }
    if (p.wait > 0) return;
    const opponent = selectTarget(p, 'attack');
    const teammate = selectTarget(p, 'pass');
    if (!opponent) return;
    // A receiver attacks next, preventing AI teammates from passing back and forth.
    const pass = teammate && !ball.receivedPass && p.zone !== 'returning' &&
      (p.zone === 'starter' ? distance(p, opponent) > 205 :
        distance(p, opponent) > 145 && Math.abs(teammate.y - opponent.y) > 85);
    throwBall(p, pass ? 'pass' : 'attack', pass ? teammate : opponent);
  }

  function looseBallCandidates() {
    if (ball.owner || ball.shot) return [];
    const team = ball.x < leftEnd || (ball.x >= center && ball.x <= rightEnd) ? 1 : 0;
    return ball.x < leftEnd || ball.x > rightEnd ? outfield(team) : infield(team);
  }

  function moveAI(p, chaser, dt) {
    if (ball.owner === p) {
      playBall(p, dt);
      return;
    }
    if (p.zone === 'infield' && evade(p, dt)) return;
    if (ball.shot?.kind === 'pass' && ball.shot.target === p) return;
    if (p === chaser) {
      move(p, ball.x - p.x, ball.y - p.y, 150, dt);
      return;
    }

    let tx, ty;
    if (p.zone === 'infield') {
      const defending = ball.owner && ball.owner.team !== p.team;
      tx = frontX(p.team, defending ? 130 : 34);
      ty = 140 + (p.number - 1) * 140 + Math.sin(time * 1.2 + p.phase) * 30;
    } else {
      const teammates = outfield(p.team);
      const lane = teammates.indexOf(p) + 1;
      const [minX, maxX] = horizontalBounds(p);
      tx = (minX + maxX) / 2 + 13 * Math.sin(time * .9 + p.phase);
      ty = top + (bottom - top) * lane / (teammates.length + 1) + (ball.y - H / 2) * .16;
    }
    move(p, tx - p.x, ty - p.y, 150, dt);
  }

  function stopFlight(drag, lock) {
    ball.shot = null;
    ball.flight = 0;
    ball.vx *= drag;
    ball.vy *= drag;
    ball.lock = lock;
    ball.trail = [];
    ball.receivedPass = false;
  }

  function takeBall(p, receivedPass = false) {
    stopFlight(0, 0);
    ball.owner = p;
    ball.receivedPass = receivedPass;
    ballIdle = 0;
    p.wait = 1.1 + Math.random() * .6;
    if (p === controlled) $('status').textContent = 'ボールを持っているよ！ Spaceで投球・Pでパス';
  }

  function hitPlayer(p, thrower) {
    effects.push({x:p.x, y:p.y, life:.6});
    p.zone = 'returning';
    const [minX, maxX] = horizontalBounds(p);
    p.x = (minX + maxX) / 2;
    p.catchUntil = 0;
    stopFlight(.3, .3);

    if (thrower.zone === 'returning') {
      thrower.zone = 'infield';
      const [min, max] = horizontalBounds(thrower);
      thrower.x = (min + max) / 2;
      thrower.y = 140 + (thrower.number - 1) * 140;
      $('status').textContent = teamName(thrower.team) + 'チームの選手が内野に復帰！';
    }
    if (p === controlled) {
      controlled = infield(0)[0];
      $('status').textContent = 'アウト！ 味方に交代したよ';
    }
    updateScore();
    if (!infield(p.team).length) finish(thrower.team);
  }

  // Return the first contact along a frame's path so fast shots cannot skip a player.
  function contactTime(p, dx, dy) {
    const x = ball.x - p.x, y = ball.y - p.y;
    const gap = x * x + y * y - (R + ballRadius) ** 2;
    if (gap <= 0) return 0;
    const travel = dx * dx + dy * dy;
    const approach = x * dx + y * dy;
    const discriminant = approach * approach - travel * gap;
    if (travel === 0 || approach >= 0 || discriminant < 0) return Infinity;
    return (-approach - Math.sqrt(discriminant)) / travel;
  }

  function moveShot(dt) {
    const {from, target, kind} = ball.shot;
    const step = Math.min(dt, ball.flight);
    const dx = ball.vx * step, dy = ball.vy * step;
    let contact = 1;
    let hit = null;
    for (const p of players) {
      const eligible = kind === 'pass' ? p === target || canTarget(from, p, 'attack') : canTarget(from, p, kind);
      if (!eligible) continue;
      const along = contactTime(p, dx, dy);
      if (along <= contact) {
        contact = along;
        hit = p;
      }
    }
    ball.x += dx * contact;
    ball.y += dy * contact;
    if (hit) {
      const caught = hit === controlled && hit.catchUntil > time;
      if (kind === 'pass' || caught) {
        hit.catchUntil = 0;
        takeBall(hit, kind === 'pass' && hit === target);
        if (caught) $('status').textContent = 'キャッチ成功！ Spaceで投球・Pでパス';
      } else hitPlayer(hit, from);
      return;
    }
    ball.trail.push({x:ball.x, y:ball.y});
    if (ball.trail.length > 10) ball.trail.shift();
    ball.flight -= step;
    const x = clamp(ball.x, margin + ballRadius, W - margin - ballRadius);
    const y = clamp(ball.y, margin + ballRadius, H - margin - ballRadius);
    if (ball.x !== x || ball.y !== y || ball.flight <= 0) stopFlight(0, .15);
    ball.x = x;
    ball.y = y;
  }

  function moveLooseBall(dt) {
    ballIdle += dt;
    if (ballIdle >= 6) {
      ball.x = center + (Math.random() < .5 ? -90 : 90);
      ball.y = H / 2;
      stopFlight(0, 0);
      ballIdle = 0;
      $('status').textContent = 'ボールを中央付近に戻したよ！';
    }
    ball.x = clamp(ball.x + ball.vx * dt, margin + ballRadius, W - margin - ballRadius);
    ball.y = clamp(ball.y + ball.vy * dt, margin + ballRadius, H - margin - ballRadius);
    const drag = Math.exp(-3 * dt);
    ball.vx *= drag;
    ball.vy *= drag;
    ball.lock = Math.max(0, ball.lock - dt);
    if (ball.lock > 0) return;
    const p = nearest(ball, looseBallCandidates());
    if (p && distance(p, ball) <= R + ballRadius) takeBall(p);
  }

  function update(dt) {
    time += dt;
    updateSpeedDisplay();
    const chaser = nearest(ball, looseBallCandidates().filter(p => p !== controlled));
    for (const p of players) {
      p.wait = Math.max(0, p.wait - dt);
      if (p === controlled) moveControlled(p, dt);
      else moveAI(p, chaser, dt);
    }
    if (ball.owner) {
      ball.x = ball.owner.x;
      ball.y = ball.owner.y - 15;
    } else if (ball.shot) moveShot(dt);
    else moveLooseBall(dt);
    effects = effects.filter(e => (e.life -= dt) > 0);
  }
  function draw() {
    ctx.clearRect(0,0,W,H);ctx.fillStyle='#21576a';ctx.fillRect(0,0,W,H);
    for (const [x, width, color, label] of [
      [margin, leftEnd - margin, '#773d4e', '赤 外野'],
      [leftEnd, center - leftEnd, '#286e88', '青 内野'],
      [center, rightEnd - center, '#68556b', '赤 内野'],
      [rightEnd, W - margin - rightEnd, '#194d70', '青 外野']
    ]) {
      ctx.fillStyle = color;
      ctx.fillRect(x, margin, width, H - 2 * margin);
      ctx.fillStyle = '#eef7ff';
      ctx.font = 'bold 15px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + width / 2, margin - 9);
    }
    ctx.strokeStyle='#dfebee';ctx.lineWidth=3;ctx.strokeRect(margin,margin,W-2*margin,H-2*margin);
    ctx.beginPath();
    for (const x of [leftEnd, center, rightEnd]) {
      ctx.moveTo(x, margin);
      ctx.lineTo(x, H - margin);
    }
    ctx.stroke();
    ctx.globalAlpha=.25;ctx.beginPath();ctx.arc(W/2,H/2,72,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;
    for (const p of players) {
      ctx.fillStyle='#102e3d55';ctx.beginPath();ctx.ellipse(p.x,p.y+18,22,9,0,0,Math.PI*2);ctx.fill();
      if (p === controlled || ball.owner === p) {
        ctx.strokeStyle = ball.owner === p ? '#ffe17b' : '#9de6ff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R + 7 + Math.sin(time * 5) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (p.zone === 'returning' || p.catchUntil > time) {
        ctx.strokeStyle = p.zone === 'returning' ? '#fff' : '#b8ffd8';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, R + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle=p.team?'#f1767d':'#58b1ff';ctx.beginPath();ctx.arc(p.x,p.y,R,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='white';ctx.font='bold 18px system-ui';ctx.textAlign='center';ctx.fillText(p.number,p.x,p.y+6);
      const label = p === controlled ? 'あなた' : {starter:'初期', returning:'復帰可'}[p.zone];
      if (label) {
        ctx.font = 'bold 13px system-ui';
        ctx.fillStyle = '#fff';
        ctx.fillText(label, p.x, p.y - 29);
      }
    }
    if (ball.shot) ball.trail.forEach((point, i) => {
      ctx.globalAlpha = i / 12;
      ctx.fillStyle = ball.shot.kind === 'pass' ? '#b8ffd8' : '#ffe17b';
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    ctx.fillStyle='#ffe183';ctx.strokeStyle='#be782e';ctx.lineWidth=2;ctx.beginPath();ctx.arc(ball.x,ball.y,10,0,Math.PI*2);ctx.fill();ctx.stroke();
    for(const e of effects){ctx.globalAlpha=e.life/.6;ctx.strokeStyle='#ffe9ac';ctx.lineWidth=4;ctx.beginPath();ctx.arc(e.x,e.y,20+(1-e.life/.6)*50,0,Math.PI*2);ctx.stroke();ctx.font='bold 19px system-ui';ctx.fillStyle='white';ctx.fillText('アウト！',e.x,e.y-35);ctx.globalAlpha=1;}
  }
  const movementKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'];
  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if (state !== 'playing' || !controlled || event.target?.tagName === 'SELECT') return;
    if (movementKeys.includes(key)) {
      event.preventDefault();
      keys.add(key);
    } else if ([' ', 'p', 'c'].includes(key)) {
      event.preventDefault();
      if (event.repeat) return;
      if (key === 'c') {
        if (ball.shot?.kind === 'attack' && ball.shot.from.team !== controlled.team && time >= controlled.nextCatch) {
          controlled.catchUntil = time + Number($('catchSetting').value);
          controlled.nextCatch = time + 1;
        }
      } else {
        const kind = key === 'p' ? 'pass' : 'attack';
        throwBall(controlled, kind, selectTarget(controlled, kind));
      }
    }
  });
  document.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => {
    keys.clear();
    last = performance.now();
  });
  $('speedSetting').addEventListener('change', updateSpeedDisplay);
  $('start').addEventListener('click', start);
  $('restart').addEventListener('click', start);
  canvas.tabIndex = 0;
  reset();

  function frame(now) {
    const dt = Math.min((now - last) / 1000, .035);
    last = now;
    if (state === 'playing') update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
