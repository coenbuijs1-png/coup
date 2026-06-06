/* ============================================================
   COUP — App bootstrap (glues UI, Game and Net)
   ============================================================ */

const App = {
  state: null,        // host: full state; guest: received view
  myIdx: 0,
  myName: '',
  oppName: '',
  gameCount: 0,
  helloSent: false,
  gameStarted: false,

  init() {
    UI.init();
    UI.showLobby();

    UI.on('createRoom', (name) => App.createRoom(name));
    UI.on('joinRoom',   (name, code) => App.joinRoom(name, code));

    UI.on('action',       (action)        => App.submitEvent({ type: 'choose_action',           player: App.myIdx, action }));
    UI.on('respondChallenge',      (decision) => App.submitEvent({ type: 'respond_challenge',         player: App.myIdx, decision }));
    UI.on('respondBlock',          (decision, role) => App.submitEvent({ type: 'respond_block',       player: App.myIdx, decision, role }));
    UI.on('respondBlockChallenge', (decision) => App.submitEvent({ type: 'respond_block_challenge',   player: App.myIdx, decision }));
    UI.on('reveal',                (cardIndex) => App.submitEvent({ type: 'choose_reveal',           player: App.myIdx, cardIndex }));
    UI.on('exchange',              (kept)      => App.submitEvent({ type: 'choose_exchange',         player: App.myIdx, keptIndices: kept }));
    UI.on('newGame',               ()          => App.requestNewGame());

    Net.on('connected', () => {
      UI.toast('Connected!', 'success');
      UI.setConnState?.('ok');
      if (!App.helloSent) {
        Net.send({ type: 'hello', name: App.myName });
        App.helloSent = true;
      }
    });
    Net.on('reconnected', () => {
      UI.toast('Reconnected!', 'success');
      UI.setConnState?.('ok');
      // Re-handshake so names + authoritative state are restored without
      // restarting the game.
      Net.send({ type: 'hello', name: App.myName });
      if (Net.getRole() === 'host' && App.gameStarted) App.broadcast();
    });
    Net.on('message',      (msg) => App.onMessage(msg));
    Net.on('disconnected', () => {
      UI.setConnState?.('warn');
    });
    Net.on('giveup', () => {
      UI.setConnState?.('bad');
      UI.toast('Lost connection. Refresh to rejoin the same room.', 'danger');
    });
    Net.on('error',        (err) => { console.warn('Net error:', err); });
    Net.on('status',       (text) => UI.setNetStatus?.(text));
  },

  async createRoom(name) {
    App.myName = name || 'Host';
    App.myIdx = 0;
    try {
      await Net.init();
      const id = await Net.hostRoom();
      UI.showRoomCode(id);
    } catch (e) {
      UI.toast('Failed to create room: ' + (e.message || e), 'danger');
    }
  },

  async joinRoom(name, code) {
    App.myName = name || 'Guest';
    App.myIdx = 1;
    UI.setJoinStatus('Connecting…', 'info');
    try {
      await Net.init();
      await Net.joinRoom(code);
      UI.setJoinStatus('Connected — waiting for game…', 'success');
    } catch (e) {
      UI.setJoinStatus('Failed: ' + (e.message || 'unknown error'), 'error');
    }
  },

  onMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'hello':
        App.oppName = msg.name || 'Opponent';
        if (Net.getRole() === 'host') {
          if (App.gameStarted) {
            // Reconnection: don't restart — just resync the authoritative state.
            App.broadcast();
            UI.render(Game.getViewFor(App.state, App.myIdx), App.myIdx);
          } else {
            App.startGame();
          }
        }
        break;
      case 'state':
        // Guest receives the authoritative view from host.
        App.state = msg.state;
        UI.render(App.state, App.myIdx);
        break;
      case 'event':
        if (Net.getRole() === 'host') {
          // Pin the player field to the actual sender (always the opponent of host).
          const evt = { ...msg.event, player: 1 - App.myIdx };
          App.applyEventAuth(evt);
        }
        break;
      case 'new_game':
        if (Net.getRole() === 'host') App.startGame();
        break;
    }
  },

  startGame() {
    // Host only — create initial state.
    const names = ['', ''];
    names[App.myIdx]     = App.myName;
    names[1 - App.myIdx] = App.oppName;
    const startingPlayer = App.gameCount % 2;
    App.gameCount += 1;
    App.gameStarted = true;
    App.state = Game.createInitialState(names, startingPlayer);
    App.broadcast();
    UI.render(Game.getViewFor(App.state, App.myIdx), App.myIdx);
  },

  submitEvent(event) {
    if (Net.getRole() === 'host') {
      App.applyEventAuth(event);
    } else {
      // Guest: send to host for authoritative processing.
      Net.send({ type: 'event', event });
    }
  },

  applyEventAuth(event) {
    // Host only — authoritative application.
    App.state = Game.applyEvent(App.state, event);
    App.broadcast();
    UI.render(Game.getViewFor(App.state, App.myIdx), App.myIdx);
  },

  broadcast() {
    if (Net.getRole() === 'host') {
      const guestIdx = 1 - App.myIdx;
      const view = Game.getViewFor(App.state, guestIdx);
      Net.send({ type: 'state', state: view });
    }
  },

  requestNewGame() {
    UI.hideGameover();
    if (Net.getRole() === 'host') {
      App.startGame();
    } else {
      Net.send({ type: 'new_game' });
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
