/* ============================================================
   COUP — UI rendering and event wiring
   ============================================================ */

const UI = (function () {

  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);
  const refs = {};
  let prevState = null;
  let listeners = {};

  // ---------- INIT ----------
  function init() {
    [
      'lobby','game','gameover','toast-container',
      'name-input','btn-create','btn-join','btn-copy',
      'join-code','create-status','room-code-display',
      'waiting-msg','join-status',
      'opp-name','opp-coins','opp-hand','opponent-panel',
      'self-name','self-coins','self-hand','self-panel',
      'deck','log','prompt-area','action-menu',
      'gameover-title','gameover-text','btn-newgame',
      'exchange-modal','exchange-pool','exchange-hint','btn-exchange-confirm',
    ].forEach(id => refs[id] = $(id));

    // Tabs
    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });

    refs['btn-create'].addEventListener('click', () => {
      const name = (refs['name-input'].value || 'Player 1').trim();
      listeners.createRoom?.(name);
    });
    refs['btn-join'].addEventListener('click', () => {
      const name = (refs['name-input'].value || 'Player 2').trim();
      const code = refs['join-code'].value.trim();
      if (!code) {
        setJoinStatus('Enter a room code.', 'error');
        return;
      }
      listeners.joinRoom?.(name, code);
    });
    refs['btn-copy'].addEventListener('click', () => {
      const code = refs['room-code-display'].textContent;
      navigator.clipboard?.writeText(code).then(
        () => toast('Room code copied'),
        () => toast('Copy failed — select the code manually', 'danger')
      );
    });
    refs['btn-newgame'].addEventListener('click', () => {
      listeners.newGame?.();
    });
    refs['btn-exchange-confirm'].addEventListener('click', () => {
      const selected = [...refs['exchange-pool'].querySelectorAll('.card.selected')]
        .map(el => parseInt(el.dataset.poolIdx, 10));
      listeners.exchange?.(selected);
    });

    // Allow ENTER on inputs
    refs['name-input'].addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const code = refs['join-code'].value.trim();
        if (code) refs['btn-join'].click(); else refs['btn-create'].click();
      }
    });
    refs['join-code'].addEventListener('keydown', (e) => {
      if (e.key === 'Enter') refs['btn-join'].click();
    });
  }

  function on(event, fn) { listeners[event] = fn; }

  // ---------- TABS ----------
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
  }

  // ---------- LOBBY ----------
  function showLobby() {
    refs.lobby.classList.add('visible');
    refs.game.classList.remove('visible');
    refs.gameover.classList.add('hidden');
    prevState = null;
  }

  function showRoomCode(code) {
    refs['room-code-display'].textContent = code;
    refs['create-status'].classList.remove('hidden');
    refs['waiting-msg'].textContent = 'Waiting for opponent…';
  }

  function setJoinStatus(text, kind) {
    refs['join-status'].textContent = text;
    refs['join-status'].className = 'status-line ' + (kind || '');
  }

  // ---------- GAME SCREEN ----------
  function showGame() {
    refs.lobby.classList.remove('visible');
    refs.game.classList.add('visible');
    refs.gameover.classList.add('hidden');
  }

  function render(state, myIdx) {
    if (!state) return;
    showGame();

    const me  = state.players[myIdx];
    const opp = state.players[1 - myIdx];

    refs['self-name'].textContent = me.name;
    refs['opp-name'].textContent  = opp.name;
    animateCoinChange(refs['self-coins'], me.coins);
    animateCoinChange(refs['opp-coins'], opp.coins);

    refs['self-panel'].classList.toggle('active-turn', state.currentPlayer === myIdx && state.phase !== 'gameover');
    refs['opponent-panel'].classList.toggle('active-turn', state.currentPlayer !== myIdx && state.phase !== 'gameover');

    renderHand(refs['self-hand'], me, true, state, myIdx);
    renderHand(refs['opp-hand'],  opp, false, state, myIdx);

    renderLog(state);
    renderPromptAndActions(state, myIdx);
    renderExchangeModal(state, myIdx);

    // Animations based on diff
    if (prevState) {
      maybeAnimateCoinTransfer(prevState, state);
      maybeAnnounceReveal(prevState, state);
    }

    if (state.phase === 'gameover' && state.winner !== null) {
      showGameover(state.players[state.winner].name, state.winner === myIdx);
    } else {
      refs.gameover.classList.add('hidden');
    }

    prevState = deepClone(state);
  }

  // ---------- HAND ----------
  function renderHand(handEl, player, isSelf, state, myIdx) {
    const total = player.hand.length + player.lostInfluences.length;
    const wanted = Math.max(2, total);

    // We render a fixed sequence: active hand cards first, then revealed (lost).
    const slots = [];
    for (let i = 0; i < player.hand.length; i++) {
      const role = player.hand[i];
      slots.push({ role, faceUp: isSelf && role !== 'hidden', revealed: false, kind: 'active', idx: i });
    }
    for (let i = 0; i < player.lostInfluences.length; i++) {
      slots.push({ role: player.lostInfluences[i], faceUp: true, revealed: true, kind: 'lost', idx: i });
    }
    while (slots.length < wanted) slots.push({ kind: 'empty' });

    // For deal animation on first render
    const isFirst = !prevState;
    const phase = state.phase;
    const mustReveal = phase === 'await_reveal' &&
      state.pendingReveal && state.pendingReveal.player === myIdx && isSelf;

    handEl.innerHTML = '';
    slots.forEach((slot, slotIdx) => {
      if (slot.kind === 'empty') {
        const empty = document.createElement('div');
        empty.style.width = 'var(--card-w)';
        empty.style.height = 'var(--card-h)';
        empty.style.opacity = '0';
        handEl.appendChild(empty);
        return;
      }
      const card = makeCardEl(slot.role, slot.faceUp);
      if (slot.revealed) card.classList.add('revealed');
      if (isFirst) {
        card.classList.add('dealing');
        card.style.animationDelay = (slotIdx * 0.12) + 's';
      }
      if (mustReveal && slot.kind === 'active') {
        card.classList.add('selectable');
        card.addEventListener('click', () => {
          listeners.reveal?.(slot.idx);
        });
      }
      handEl.appendChild(card);
    });
  }

  function makeCardEl(role, faceUp) {
    const card = document.createElement('div');
    card.className = 'card ' + (faceUp ? 'face-up' : 'face-down');
    const back = document.createElement('div');
    back.className = 'face back';
    const front = document.createElement('div');
    front.className = 'face front';
    if (role && role !== 'hidden' && ROLES[role]) {
      front.style.backgroundImage = `url('${ROLES[role].image}')`;
    } else {
      front.style.backgroundImage = `url('cards/back.png')`;
    }
    card.appendChild(back);
    card.appendChild(front);
    return card;
  }

  // ---------- LOG ----------
  function renderLog(state) {
    const last = state.log.slice(-6);
    const existingIds = new Set([...refs.log.querySelectorAll('.entry')].map(e => e.dataset.id));
    refs.log.innerHTML = '';
    for (const entry of last) {
      const div = document.createElement('div');
      div.className = 'entry' + (entry.kind ? ' ' + entry.kind : '');
      div.dataset.id = entry.id;
      div.textContent = entry.text;
      if (!existingIds.has(entry.id)) {
        // animate in
      }
      refs.log.appendChild(div);
    }
    refs.log.scrollTop = refs.log.scrollHeight;
  }

  // ---------- PROMPT + ACTIONS ----------
  function renderPromptAndActions(state, myIdx) {
    refs['prompt-area'].innerHTML = '';
    refs['action-menu'].innerHTML = '';

    if (state.phase === 'gameover') return;

    const myTurn = Game.whoseTurnToAct(state) === myIdx;

    switch (state.phase) {
      case 'turn_start':
        if (myTurn) {
          showPrompt('Your turn — choose an action.');
          renderActionMenu(state, myIdx);
        } else {
          showPrompt(`Waiting for ${state.players[state.currentPlayer].name}…`);
        }
        break;

      case 'await_challenge': {
        const pa = state.pendingAction;
        const actorName = state.players[pa.actor].name;
        const claim = ROLES[pa.role].name;
        const actionLbl = ACTIONS[pa.action].label;
        if (myTurn) {
          showPrompt(`${actorName} claims ${claim} (${actionLbl}). Challenge?`);
          showPromptButtons([
            { label: `Challenge ${claim}`, cls: 'btn-challenge', onClick: () => listeners.respondChallenge?.('challenge') },
            { label: `Allow`, cls: 'btn-pass', onClick: () => listeners.respondChallenge?.('pass') },
          ]);
        } else {
          showPrompt(`You claimed ${claim}. Waiting for ${state.players[1 - myIdx].name} to challenge or allow…`);
        }
        break;
      }

      case 'await_block': {
        const pa = state.pendingAction;
        const def = ACTIONS[pa.action];
        const actorName = state.players[pa.actor].name;
        if (myTurn) {
          showPrompt(`${actorName} attempts ${def.label}. Block?`);
          const buttons = def.blockedBy.map(role => ({
            label: `Block (${ROLES[role].name})`,
            cls: 'btn-block',
            onClick: () => listeners.respondBlock?.('block', role),
          }));
          buttons.push({ label: `Allow`, cls: 'btn-pass', onClick: () => listeners.respondBlock?.('pass') });
          showPromptButtons(buttons);
        } else {
          showPrompt(`Waiting for ${state.players[1 - myIdx].name} to block or allow…`);
        }
        break;
      }

      case 'await_block_challenge': {
        const pb = state.pendingBlock;
        const blockerName = state.players[pb.blocker].name;
        const role = ROLES[pb.role].name;
        if (myTurn) {
          showPrompt(`${blockerName} claims ${role} to block. Challenge?`);
          showPromptButtons([
            { label: `Challenge ${role}`, cls: 'btn-challenge', onClick: () => listeners.respondBlockChallenge?.('challenge') },
            { label: `Accept block`, cls: 'btn-pass', onClick: () => listeners.respondBlockChallenge?.('pass') },
          ]);
        } else {
          showPrompt(`You claimed ${role} to block. Waiting for ${state.players[1 - myIdx].name}…`);
        }
        break;
      }

      case 'await_reveal':
        if (myTurn) {
          showPrompt(`Choose which card to reveal (lose).`);
        } else {
          showPrompt(`Waiting for ${state.players[state.pendingReveal.player].name} to reveal a card…`);
        }
        break;

      case 'await_exchange':
        if (myTurn) {
          showPrompt(`Pick cards to keep…`);
        } else {
          showPrompt(`Waiting for ${state.players[state.pendingExchange.player].name} to choose cards…`);
        }
        break;
    }
  }

  function renderActionMenu(state, myIdx) {
    const available = Game.getAvailableActions(state, myIdx);
    if (available.length === 0) return;
    const me = state.players[myIdx];

    // Display in a fixed canonical order
    const order = ['income', 'foreign_aid', 'tax', 'steal', 'assassinate', 'exchange', 'coup'];

    for (const a of order) {
      const def = ACTIONS[a];
      const enabled = available.includes(a);
      // 10+ coins forces Coup
      const forced = me.coins >= 10 && a === 'coup';

      const btn = document.createElement('button');
      btn.className = 'action-btn' + (def.role ? ' character' : '') + (forced ? ' force' : '');
      btn.disabled = !enabled;
      const role = def.role ? `<span class="role">${ROLES[def.role].name}</span>` : '';
      btn.innerHTML = `${def.label}${role}`;
      btn.title = def.desc + (def.cost ? ` (cost ${def.cost})` : '');
      btn.addEventListener('click', () => listeners.action?.(a));
      refs['action-menu'].appendChild(btn);
    }
  }

  function showPrompt(text) {
    const p = document.createElement('div');
    p.className = 'prompt-text';
    p.textContent = text;
    refs['prompt-area'].appendChild(p);
  }

  function showPromptButtons(buttons) {
    const wrap = document.createElement('div');
    wrap.className = 'prompt-buttons';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = b.cls || 'btn-pass';
      btn.textContent = b.label;
      btn.addEventListener('click', b.onClick);
      wrap.appendChild(btn);
    }
    refs['prompt-area'].appendChild(wrap);
  }

  // ---------- EXCHANGE MODAL ----------
  function renderExchangeModal(state, myIdx) {
    const ex = state.pendingExchange;
    const shouldShow = ex && ex.player === myIdx && state.phase === 'await_exchange';
    if (!shouldShow) {
      refs['exchange-modal'].classList.add('hidden');
      return;
    }
    if (!refs['exchange-modal'].classList.contains('hidden')) {
      // already showing — don't redraw
      return;
    }
    refs['exchange-modal'].classList.remove('hidden');
    refs['exchange-pool'].innerHTML = '';

    const pool = [...ex.handCards, ...ex.drawnCards];
    const wantKeep = ex.handSize;

    pool.forEach((role, idx) => {
      const card = makeCardEl(role, true);
      card.classList.add('selectable');
      card.dataset.poolIdx = idx;
      card.addEventListener('click', () => {
        const selected = refs['exchange-pool'].querySelectorAll('.card.selected');
        if (card.classList.contains('selected')) {
          card.classList.remove('selected');
        } else {
          if (selected.length >= wantKeep) return;
          card.classList.add('selected');
        }
        updateExchangeUI(wantKeep);
      });
      refs['exchange-pool'].appendChild(card);
    });
    updateExchangeUI(wantKeep);
  }

  function updateExchangeUI(wantKeep) {
    const selected = refs['exchange-pool'].querySelectorAll('.card.selected').length;
    const remaining = wantKeep - selected;
    refs['exchange-hint'].textContent = remaining === 0
      ? `Ready — confirm your selection.`
      : `Select ${remaining} more card${remaining === 1 ? '' : 's'} to keep.`;
    refs['btn-exchange-confirm'].disabled = selected !== wantKeep;
  }

  // ---------- COIN ANIMATIONS ----------
  function animateCoinChange(el, value) {
    if (el.textContent != String(value)) {
      el.textContent = value;
      el.parentElement.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
        { duration: 360, easing: 'ease-out' }
      );
    }
  }

  function maybeAnimateCoinTransfer(prev, curr) {
    for (let i = 0; i < 2; i++) {
      const dCoins = curr.players[i].coins - prev.players[i].coins;
      if (dCoins > 0) {
        // some coins gained — flyer from center or from opponent
        const sourceEl = (curr.players[1 - i].coins < prev.players[1 - i].coins)
          ? document.querySelector(i === curr.viewerIdx ? '#opp-coins' : '#self-coins')
          : refs.deck;
        const targetEl = document.querySelector(i === curr.viewerIdx ? '#self-coins' : '#opp-coins');
        if (sourceEl && targetEl) flyCoin(sourceEl, targetEl);
      }
    }
  }

  function flyCoin(fromEl, toEl) {
    const fromR = fromEl.getBoundingClientRect();
    const toR = toEl.getBoundingClientRect();
    const fx = fromR.left + fromR.width / 2 - 12;
    const fy = fromR.top + fromR.height / 2 - 12;
    const tx = toR.left + toR.width / 2 - 12;
    const ty = toR.top + toR.height / 2 - 12;
    const coin = document.createElement('div');
    coin.className = 'coin-flyer';
    coin.style.left = fx + 'px';
    coin.style.top = fy + 'px';
    document.body.appendChild(coin);
    requestAnimationFrame(() => {
      coin.style.transform = `translate(${tx - fx}px, ${ty - fy}px) scale(0.7)`;
      coin.style.opacity = '0.2';
    });
    setTimeout(() => coin.remove(), 800);
  }

  // ---------- REVEAL ANNOUNCEMENTS ----------
  function maybeAnnounceReveal(prev, curr) {
    for (let i = 0; i < 2; i++) {
      const a = prev.players[i].lostInfluences.length;
      const b = curr.players[i].lostInfluences.length;
      if (b > a) {
        const newRoles = curr.players[i].lostInfluences.slice(a);
        for (const r of newRoles) {
          toast(`${curr.players[i].name} lost ${ROLES[r].name}`, 'danger');
        }
      }
    }
  }

  // ---------- GAMEOVER ----------
  function showGameover(winnerName, isWinner) {
    refs.gameover.classList.remove('hidden');
    refs['gameover-title'].textContent = isWinner ? 'Victory' : 'Defeat';
    refs['gameover-text'].textContent = isWinner
      ? `You crushed ${prevState ? '' : ''}the opposition.`
      : `${winnerName} outplayed you.`;
  }

  function hideGameover() {
    refs.gameover.classList.add('hidden');
  }

  // ---------- TOASTS ----------
  function toast(text, kind) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = text;
    refs['toast-container'].appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  // ---------- UTIL ----------
  function deepClone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function setConnState(state) {
    // state: 'ok' | 'warn' | 'bad'
    const pill = document.getElementById('conn-pill');
    const txt = document.getElementById('conn-text');
    if (!pill || !txt) return;
    pill.classList.remove('ok', 'warn', 'bad');
    pill.classList.add(state);
    txt.textContent = state === 'ok' ? 'Connected'
      : state === 'warn' ? 'Reconnecting…'
      : 'Disconnected';
  }

  function setNetStatus(text) {
    // Show network status either under join code or the waiting message.
    const waiting = refs['waiting-msg'];
    if (waiting && !refs['create-status'].classList.contains('hidden')) {
      waiting.textContent = text;
    }
    const joinStatus = refs['join-status'];
    if (joinStatus && refs['lobby'].classList.contains('visible')) {
      const inJoinTab = document.querySelector('#tab-join.active') !== null;
      if (inJoinTab) {
        joinStatus.textContent = text;
        joinStatus.className = 'status-line info';
      }
    }
  }

  return {
    init, on,
    showLobby, showGame,
    showRoomCode, setJoinStatus, setNetStatus, setConnState,
    render,
    showGameover, hideGameover,
    toast,
  };
})();
