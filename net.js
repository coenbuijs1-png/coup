/* ============================================================
   COUP — Networking (PeerJS over WebRTC)
   ============================================================ */

const Net = (function () {
  let peer = null;
  let conn = null;
  let isHost = false;

  const handlers = {
    open: [],
    connected: [],
    message: [],
    disconnected: [],
    error: [],
  };

  function on(event, fn) {
    if (handlers[event]) handlers[event].push(fn);
  }

  function emit(event, ...args) {
    (handlers[event] || []).forEach(fn => {
      try { fn(...args); } catch (e) { console.error(e); }
    });
  }

  function init() {
    return new Promise((resolve, reject) => {
      // Use a short readable ID by combining 3 words; PeerJS would give us a random one,
      // but we'll generate our own friendlier code.
      const code = generateRoomCode();
      peer = new Peer(code, {
        // Use PeerJS' default public broker (peerjs.com); fine for two players.
        debug: 1,
      });
      peer.on('open', (id) => {
        emit('open', id);
        resolve(id);
      });
      peer.on('error', (err) => {
        // If ID was taken, try a fresh random one
        if (err && err.type === 'unavailable-id') {
          peer.destroy();
          peer = new Peer(undefined, { debug: 1 });
          peer.on('open', (id) => { emit('open', id); resolve(id); });
          peer.on('error', (e) => { emit('error', e); reject(e); });
          peer.on('connection', _setupIncoming);
          return;
        }
        emit('error', err);
        // Don't reject here if already open — peer.js fires errors during normal life.
      });
      peer.on('connection', _setupIncoming);
    });
  }

  function _setupIncoming(c) {
    if (!isHost) return;          // only host accepts inbound
    if (conn && conn.open) {       // already have an opponent
      c.close();
      return;
    }
    conn = c;
    _wireConn(conn);
  }

  function _wireConn(c) {
    c.on('open', () => {
      emit('connected', isHost);
    });
    c.on('data', (data) => {
      emit('message', data);
    });
    c.on('close', () => {
      emit('disconnected');
    });
    c.on('error', (err) => {
      emit('error', err);
    });
  }

  function hostRoom() {
    isHost = true;
    // Already initialized via init(); just wait for a peer to connect.
    return peer.id;
  }

  function joinRoom(remoteId) {
    isHost = false;
    return new Promise((resolve, reject) => {
      const c = peer.connect(remoteId, { reliable: true });
      conn = c;
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Connection timed out. Check the room code.'));
        }
      }, 15000);
      c.on('open', () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        _wireConn(c);
        emit('connected', isHost);
        resolve();
      });
      c.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function send(msg) {
    if (conn && conn.open) {
      conn.send(msg);
    }
  }

  function getRole() { return isHost ? 'host' : 'guest'; }

  // Random 3-word style room code; falls back to alphanumeric.
  function generateRoomCode() {
    const adj = ['red','blue','gold','dark','wild','swift','calm','keen','vast','bold'];
    const noun = ['fox','wolf','duke','lion','crow','sage','tide','moon','rook','spire'];
    const a = adj[Math.floor(Math.random() * adj.length)];
    const n = noun[Math.floor(Math.random() * noun.length)];
    const num = Math.floor(Math.random() * 900) + 100;
    return `coup-${a}-${n}-${num}`;
  }

  return { init, hostRoom, joinRoom, send, on, getRole };
})();
