/* ============================================================
   COUP — Game state machine (host-authoritative)
   Pure-ish reducer: applyEvent(state, event) mutates state.
   ============================================================ */

const Game = (function () {

  // ---------- INITIAL STATE ----------

  function createInitialState(playerNames, startingPlayer = 0) {
    const deck = shuffle(buildDeck());
    const players = playerNames.map((name, i) => ({
      id: i,
      name,
      coins: 2,
      hand: [deck.pop(), deck.pop()],
      lostInfluences: [],
    }));
    return {
      phase: 'turn_start',
      currentPlayer: startingPlayer,
      players,
      deck,
      pendingAction: null,    // { actor, action, target, role }
      pendingBlock: null,     // { blocker, role }
      pendingReveal: null,    // { player, reason }
      pendingExchange: null,  // { player, handCards, drawnCards, handSize }
      log: [],
      winner: null,
      version: 0,
    };
  }

  // ---------- HELPERS ----------

  function opponent(idx) { return 1 - idx; }

  function addLog(state, text, kind = '') {
    state.log.push({ text, kind, t: Date.now(), id: Math.random().toString(36).slice(2, 9) });
    if (state.log.length > 60) state.log.shift();
  }

  function getAvailableActions(state, playerIdx) {
    if (state.phase !== 'turn_start') return [];
    if (state.currentPlayer !== playerIdx) return [];
    const p = state.players[playerIdx];
    if (p.coins >= 10) return ['coup'];
    const out = ['income', 'foreign_aid', 'tax', 'exchange', 'steal'];
    if (p.coins >= 3) out.push('assassinate');
    if (p.coins >= 7) out.push('coup');
    return out;
  }

  // ---------- EVENT DISPATCH ----------

  function applyEvent(state, event) {
    let next;
    switch (event.type) {
      case 'choose_action':            next = handleChooseAction(state, event); break;
      case 'respond_challenge':        next = handleRespondChallenge(state, event); break;
      case 'respond_block':            next = handleRespondBlock(state, event); break;
      case 'respond_block_challenge':  next = handleRespondBlockChallenge(state, event); break;
      case 'choose_reveal':            next = handleChooseReveal(state, event); break;
      case 'choose_exchange':          next = handleChooseExchange(state, event); break;
      default: return state;
    }
    next.version = (state.version || 0) + 1;
    return next;
  }

  // ---------- HANDLERS ----------

  function handleChooseAction(state, event) {
    if (state.phase !== 'turn_start') return state;
    if (state.currentPlayer !== event.player) return state;
    const available = getAvailableActions(state, event.player);
    if (!available.includes(event.action)) return state;

    const def = ACTIONS[event.action];
    const actor = state.players[event.player];

    // Pay cost up-front. Coins are NOT refunded if action is blocked/challenged.
    actor.coins -= def.cost;

    state.pendingAction = {
      actor: event.player,
      action: event.action,
      target: def.needsTarget ? opponent(event.player) : null,
      role: def.role || null,
    };

    const roleSuffix = def.role ? ` (claiming ${ROLES[def.role].name})` : '';
    const targetSuffix = def.needsTarget ? ` on ${state.players[opponent(event.player)].name}` : '';
    addLog(state, `${actor.name} plays ${def.label}${targetSuffix}${roleSuffix}.`, 'highlight');

    // Decide next phase
    if (def.challengeable) {
      state.phase = 'await_challenge';
    } else if (def.blockable) {
      state.phase = 'await_block';
    } else {
      return resolveAction(state);
    }
    return state;
  }

  function handleRespondChallenge(state, event) {
    if (state.phase !== 'await_challenge') return state;
    const opp = opponent(state.pendingAction.actor);
    if (event.player !== opp) return state;

    if (event.decision === 'pass') {
      const def = ACTIONS[state.pendingAction.action];
      addLog(state, `${state.players[opp].name} doesn't challenge.`);
      if (def.blockable) {
        state.phase = 'await_block';
      } else {
        return resolveAction(state);
      }
      return state;
    }

    // CHALLENGE
    const claim = state.pendingAction.role;
    const actor = state.players[state.pendingAction.actor];
    const challenger = state.players[opp];
    addLog(state, `${challenger.name} challenges the ${ROLES[claim].name} claim!`, 'highlight');

    if (actor.hand.includes(claim)) {
      // Actor proves it — challenger loses an influence
      addLog(state, `${actor.name} reveals ${ROLES[claim].name}. ${challenger.name} loses an influence.`, 'danger');
      swapCardWithDeck(state, actor, claim);
      state.pendingReveal = { player: opp, reason: 'lost_challenge' };
      state.phase = 'await_reveal';
    } else {
      // Bluff caught — actor loses an influence, action fails
      addLog(state, `${actor.name} cannot show a ${ROLES[claim].name} — bluff caught!`, 'success');
      state.pendingReveal = { player: state.pendingAction.actor, reason: 'lost_challenge_action_fails' };
      state.phase = 'await_reveal';
    }
    return state;
  }

  function handleRespondBlock(state, event) {
    if (state.phase !== 'await_block') return state;
    const opp = opponent(state.pendingAction.actor);
    if (event.player !== opp) return state;

    if (event.decision === 'pass') {
      addLog(state, `${state.players[opp].name} doesn't block.`);
      return resolveAction(state);
    }

    const def = ACTIONS[state.pendingAction.action];
    const role = event.role;
    if (!def.blockable || !def.blockedBy || !def.blockedBy.includes(role)) {
      return state; // invalid block role
    }
    state.pendingBlock = { blocker: opp, role };
    addLog(state, `${state.players[opp].name} blocks with ${ROLES[role].name}.`, 'highlight');
    state.phase = 'await_block_challenge';
    return state;
  }

  function handleRespondBlockChallenge(state, event) {
    if (state.phase !== 'await_block_challenge') return state;
    if (event.player !== state.pendingAction.actor) return state;

    if (event.decision === 'pass') {
      addLog(state, `${state.players[event.player].name} accepts the block. Action fails.`);
      cleanupAction(state);
      return endTurn(state);
    }

    // Challenge the block
    const blocker = state.players[state.pendingBlock.blocker];
    const blockRole = state.pendingBlock.role;
    const actor = state.players[event.player];
    addLog(state, `${actor.name} challenges the ${ROLES[blockRole].name} block!`, 'highlight');

    if (blocker.hand.includes(blockRole)) {
      // Block stands; challenger (actor) loses influence
      addLog(state, `${blocker.name} reveals ${ROLES[blockRole].name}. ${actor.name} loses an influence.`, 'danger');
      swapCardWithDeck(state, blocker, blockRole);
      state.pendingReveal = { player: event.player, reason: 'lost_block_challenge' };
      state.phase = 'await_reveal';
    } else {
      // Block was bluff — blocker loses; action then proceeds
      addLog(state, `${blocker.name} cannot show a ${ROLES[blockRole].name} — bluff caught!`, 'success');
      state.pendingReveal = { player: state.pendingBlock.blocker, reason: 'lost_block_challenge_block_fails' };
      state.phase = 'await_reveal';
    }
    return state;
  }

  function handleChooseReveal(state, event) {
    if (state.phase !== 'await_reveal') return state;
    if (event.player !== state.pendingReveal.player) return state;

    const p = state.players[event.player];
    const idx = event.cardIndex;
    if (idx < 0 || idx >= p.hand.length) return state;

    const lost = p.hand[idx];
    p.hand.splice(idx, 1);
    p.lostInfluences.push(lost);
    addLog(state, `${p.name} reveals ${ROLES[lost].name}.`, 'danger');

    // Game over check
    if (p.hand.length === 0) {
      const winnerIdx = opponent(event.player);
      state.winner = winnerIdx;
      state.phase = 'gameover';
      addLog(state, `${state.players[winnerIdx].name} wins!`, 'success');
      return state;
    }

    const reason = state.pendingReveal.reason;
    state.pendingReveal = null;

    switch (reason) {
      case 'lost_challenge': {
        // Challenger lost; action continues
        const def = ACTIONS[state.pendingAction.action];
        if (def.blockable) {
          state.phase = 'await_block';
        } else {
          return resolveAction(state);
        }
        return state;
      }
      case 'lost_challenge_action_fails':
        // Actor's bluff caught; action fails
        cleanupAction(state);
        return endTurn(state);
      case 'lost_block_challenge':
        // Actor challenged block and lost; block stands; action fails
        cleanupAction(state);
        return endTurn(state);
      case 'lost_block_challenge_block_fails':
        // Blocker's bluff caught; block fails; action proceeds
        state.pendingBlock = null;
        return resolveAction(state);
      case 'coup':
      case 'assassinated':
        // Target lost the influence; action complete
        cleanupAction(state);
        return endTurn(state);
    }
    return state;
  }

  function handleChooseExchange(state, event) {
    if (state.phase !== 'await_exchange') return state;
    const ex = state.pendingExchange;
    if (!ex || event.player !== ex.player) return state;

    const pool = [...ex.handCards, ...ex.drawnCards];
    const wantSize = ex.handSize;
    if (!Array.isArray(event.keptIndices)) return state;
    if (event.keptIndices.length !== wantSize) return state;
    if (new Set(event.keptIndices).size !== wantSize) return state;
    if (event.keptIndices.some(i => i < 0 || i >= pool.length)) return state;

    const kept = event.keptIndices.map(i => pool[i]);
    const returned = pool.filter((_, i) => !event.keptIndices.includes(i));
    state.players[event.player].hand = kept;
    state.deck.push(...returned);
    state.deck = shuffle(state.deck);

    addLog(state, `${state.players[event.player].name} exchanged cards with the court deck.`);
    state.pendingExchange = null;
    cleanupAction(state);
    return endTurn(state);
  }

  // ---------- ACTION RESOLUTION ----------

  function resolveAction(state) {
    const pa = state.pendingAction;
    const action = pa.action;
    const actor = state.players[pa.actor];
    const target = pa.target !== null ? state.players[pa.target] : null;

    switch (action) {
      case 'income':
        actor.coins += 1;
        addLog(state, `${actor.name} takes 1 coin.`);
        cleanupAction(state);
        return endTurn(state);

      case 'foreign_aid':
        actor.coins += 2;
        addLog(state, `${actor.name} takes 2 coins from Foreign Aid.`);
        cleanupAction(state);
        return endTurn(state);

      case 'tax':
        actor.coins += 3;
        addLog(state, `${actor.name} takes 3 coins (Tax).`);
        cleanupAction(state);
        return endTurn(state);

      case 'steal': {
        const amt = Math.min(2, target.coins);
        target.coins -= amt;
        actor.coins += amt;
        addLog(state, `${actor.name} steals ${amt} coin${amt === 1 ? '' : 's'} from ${target.name}.`);
        cleanupAction(state);
        return endTurn(state);
      }

      case 'coup':
        state.pendingReveal = { player: pa.target, reason: 'coup' };
        state.phase = 'await_reveal';
        addLog(state, `${target.name} must lose an influence to the Coup.`);
        return state;

      case 'assassinate':
        state.pendingReveal = { player: pa.target, reason: 'assassinated' };
        state.phase = 'await_reveal';
        addLog(state, `${target.name} is assassinated and must lose an influence.`);
        return state;

      case 'exchange': {
        const drawn = [state.deck.pop(), state.deck.pop()].filter(c => c !== undefined);
        state.pendingExchange = {
          player: pa.actor,
          handCards: actor.hand.slice(),
          drawnCards: drawn,
          handSize: actor.hand.length,
        };
        state.phase = 'await_exchange';
        addLog(state, `${actor.name} draws 2 cards to exchange.`);
        return state;
      }
    }
    return state;
  }

  // ---------- UTILITIES ----------

  function swapCardWithDeck(state, player, role) {
    const idx = player.hand.indexOf(role);
    if (idx === -1) return;
    player.hand.splice(idx, 1);
    state.deck.push(role);
    state.deck = shuffle(state.deck);
    const drawn = state.deck.pop();
    if (drawn !== undefined) player.hand.push(drawn);
  }

  function cleanupAction(state) {
    state.pendingAction = null;
    state.pendingBlock = null;
  }

  function endTurn(state) {
    if (state.phase === 'gameover') return state;
    state.currentPlayer = opponent(state.currentPlayer);
    state.phase = 'turn_start';
    return state;
  }

  // ---------- VIEW (redaction for sending to other player) ----------

  // For 2P: hide the OTHER player's hand cards. The exchange pool drawn cards
  // are only visible to the player doing the exchange.
  function getViewFor(state, viewerIdx) {
    const view = JSON.parse(JSON.stringify(state));
    view.players.forEach((p, i) => {
      if (i !== viewerIdx) {
        p.hand = p.hand.map(() => 'hidden');
      }
    });
    // Hide deck contents from both players (only deck size matters for UI)
    view.deck = view.deck.map(() => 'hidden');
    // Hide exchange drawn cards if not the actor
    if (view.pendingExchange && view.pendingExchange.player !== viewerIdx) {
      view.pendingExchange = {
        ...view.pendingExchange,
        handCards: view.pendingExchange.handCards.map(() => 'hidden'),
        drawnCards: view.pendingExchange.drawnCards.map(() => 'hidden'),
      };
    }
    view.viewerIdx = viewerIdx;
    return view;
  }

  // ---------- WHO MUST ACT ----------

  function whoseTurnToAct(state) {
    switch (state.phase) {
      case 'turn_start':              return state.currentPlayer;
      case 'await_challenge':         return opponent(state.pendingAction.actor);
      case 'await_block':             return opponent(state.pendingAction.actor);
      case 'await_block_challenge':   return state.pendingAction.actor;
      case 'await_reveal':            return state.pendingReveal.player;
      case 'await_exchange':          return state.pendingExchange.player;
      default:                        return null;
    }
  }

  return {
    createInitialState,
    applyEvent,
    getAvailableActions,
    getViewFor,
    whoseTurnToAct,
  };
})();
