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
      let settled = false;
      // Use a short readable ID; if it's already taken on the broker, retry with random.
      const code = generateRoomCode();
      peer = new Peer(code, { debug: 1 });
      const openTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Couldn't reach the PeerJS signaling server. Check your internet and try again."));
        }
      }, 12000);

      peer.on('open', (id) => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimer);
        emit('open', id);
        resolve(id);
      });
      peer.on('error', (err) => {
        // ID collision — retry once with a random ID.
        if (err && err.type === 'unavailable-id') {
          peer.destroy();
          peer = new Peer(undefined, { debug: 1 });
          peer.on('open', (id) => {
            if (settled) return;
            settled = true;
            clearTimeout(openTimer);
            emit('open', id);
            resolve(id);
          });
          peer.on('error', (e) => {
            if (settled) return;
            settled = true;
            clearTimeout(openTimer);
            emit('error', e);
            reject(e);
          });
          peer.on('connection', _setupIncoming);
          return;
        }
        emit('error', err);
        // Fatal init errors before open: reject so caller can show a message.
        if (!settled && (err.type === 'network' || err.type === 'server-error' || err.type === 'browser-incompatible' || err.type === 'ssl-unavailable' || err.type === 'socket-error' || err.type === 'socket-closed')) {
          settled = true;
          clearTimeout(openTimer);
          reject(new Error(`Network error (${err.type}). Reload the page and try again.`));
        }
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
      let resolved = false;
      const finish = (err, ok) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        peer.off?.('error', onPeerErr);
        if (ok) resolve(); else reject(err);
      };
      // Listen for "peer-unavailable" on the peer object — fires when the host
      // never registered that ID or has since disconnected.
      const onPeerErr = (err) => {
        if (err && err.type === 'peer-unavailable') {
          finish(new Error(`No active host found for "${remoteId}". The host's tab must be open. Ask them to click "Create room" again and share the new code.`));
        }
      };
      peer.on('error', onPeerErr);

      const c = peer.connect(remoteId, { reliable: true });
      conn = c;
      const timer = setTimeout(() => {
        finish(new Error(`Couldn't reach the host. Make sure their tab is open on "Create room" with the code "${remoteId}" showing, then try again.`));
      }, 8000);
      c.on('open', () => {
        _wireConn(c);
        emit('connected', isHost);
        finish(null, true);
      });
      c.on('error', (err) => {
        finish(err, false);
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
