// The DOM HUD: crosshair, hit marker, health, ammo, timer, score, money, alive
// counts, kill feed, damage direction, banners, buy menu and overlays. It never
// touches the simulation; main.js pushes numbers in and reads callbacks out.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), hud: $('hud'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    damageDir: $('damage-dir'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
    ammo: $('ammo'), weaponName: $('weapon-name'), healthFill: $('health-fill'),
    healthNum: $('health-num'), timer: $('timer'), roundLabel: $('round-label'),
    scoreS: $('score-s'), scoreR: $('score-r'), money: $('money'),
    aliveS: $('alive-s'), aliveR: $('alive-r'), killfeed: $('killfeed'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    buy: $('buy'), buyMoney: $('buy-money'), grenadeCount: $('grenade-count'),
    chargeState: $('charge-state'), plantBar: $('plant-bar'), plantFill: $('plant-fill'),
    match: $('match'), matchTitle: $('match-title'), matchScore: $('match-score'),
    restart: $('restart'), mute: $('mute'),
  };
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};
  let playHandler = null;
  let restartHandler = null;

  function setText(el, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      el.textContent = value;
    }
  }

  const api = {
    setHealth(hp) {
      setText(els.healthNum, 'hp', String(Math.max(0, Math.ceil(hp))));
      const pct = Math.max(0, Math.min(100, hp));
      if (last.hppct !== pct) {
        last.hppct = pct;
        els.healthFill.style.width = `${pct}%`;
        els.healthFill.classList.toggle('low', pct <= 30);
      }
    },
    setAmmo(mag, reserve, name, grenades) {
      setText(els.ammoMag, 'mag', String(mag));
      setText(els.ammoReserve, 'res', `/ ${reserve}`);
      setText(els.weaponName, 'wname', name);
      setText(els.grenadeCount, 'nades', `GRENADES ${grenades}`);
      els.ammo.classList.toggle('empty', mag === 0);
    },
    setTimer(seconds, live = true) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(els.timer, 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      els.timer.classList.toggle('low', live && s <= 15);
    },
    setScore(s, r, round) {
      setText(els.scoreS, 'ss', String(s));
      setText(els.scoreR, 'sr', String(r));
      setText(els.roundLabel, 'round', `ROUND ${round}`);
    },
    setMoney(value) {
      setText(els.money, 'money', `$${value}`);
      setText(els.buyMoney, 'bmoney', `$${value}`);
    },
    setAlive(s, r) {
      setText(els.aliveS, 'as', `${s} ALIVE`);
      setText(els.aliveR, 'ar', `${r} ALIVE`);
    },
    setCharge(text) { setText(els.chargeState, 'charge', text); },
    setPlant(progress, label) {
      els.plantBar.hidden = progress <= 0;
      if (progress > 0) {
        els.plantFill.style.width = `${Math.min(100, progress * 100)}%`;
        setText(els.plantFill, 'plabel', label);
      }
    },
    setCrosshair(spreadPx) {
      const v = Math.round(spreadPx);
      if (last.spread !== v) {
        last.spread = v;
        els.crosshair.style.setProperty('--gap', `${v}px`);
      }
    },
    hitMarker(head, kill) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('head', head);
      els.hitmarker.classList.toggle('kill', kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'head', 'kill'), 140);
    },
    damageFrom(angle) {
      const deg = ((angle * 180) / Math.PI + 180).toFixed(0);
      els.damageDir.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
      els.damageDir.classList.add('on');
      setTimeout(() => els.damageDir.classList.remove('on'), 450);
    },
    killfeed(text, team) {
      const entry = document.createElement('div');
      entry.className = `feed-${team}`;
      entry.textContent = text;
      els.killfeed.prepend(entry);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
      setTimeout(() => entry.remove(), 6000);
    },
    banner(title, sub, tone) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub || '';
      els.banner.className = `show tone-${tone || 'info'}`;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => els.banner.classList.remove('show'), 3200);
    },
    showBuy(show) { els.buy.hidden = !show; },
    updateBuy(owned, money) {
      for (const row of els.buy.querySelectorAll('[data-weapon]')) {
        const id = row.dataset.weapon;
        const price = row.dataset.price;
        row.classList.toggle('owned', owned === id);
        row.classList.toggle('cant', Number(price) > money && owned !== id);
      }
      const grenade = els.buy.querySelector('[data-weapon="grenade"]');
      grenade.classList.toggle('cant', money < 300);
    },
    showOverlay(mode, data) {
      const copy = {
        start: ['MONSOON STRIKE', 'Barsha Guard vs Neon Reavers on a rainy Dhaka night street — plant the charge at Site A or Site B, or eliminate the enemy team. First to 5 rounds takes the match.', 'Click to play'],
        paused: ['Paused', 'Click to resume. Buy phase is still running.', 'Click to resume'],
        dead: ['You are down', 'Your team is still fighting. Spectate until the round ends.', ''],
      }[mode];
      els.overlayTitle.textContent = copy[0];
      els.overlayCopy.textContent = copy[1];
      els.play.textContent = copy[2];
      els.play.style.display = mode === 'dead' ? 'none' : '';
      els.overlay.hidden = false;
    },
    hideOverlay() { els.overlay.hidden = true; },
    showMatch(won, score) {
      els.matchTitle.textContent = won ? 'MATCH WON' : 'MATCH LOST';
      els.matchTitle.className = won ? 'win' : 'lose';
      els.matchScore.textContent = `Barsha Guard ${score.sentinel} — ${score.reaver} Neon Reavers`;
      els.match.hidden = false;
    },
    hideMatch() { els.match.hidden = true; },
    setMuted(muted) { setText(els.mute, 'mute', muted ? 'SOUND OFF [M]' : 'SOUND ON [M]'); },
    onPlay(handler) { playHandler = handler; },
    onRestart(handler) { restartHandler = handler; },
  };

  els.play.addEventListener('click', () => playHandler && playHandler());
  els.restart.addEventListener('click', () => restartHandler && restartHandler());
  return api;
}
