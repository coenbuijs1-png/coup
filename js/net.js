/* ============================================================
   COUP — Networking via Trystero (WebRTC over BT-tracker signaling)
   Replaces the older PeerJS-based version. Signaling now goes
   through multiple public BitTorrent trackers, so it doesn't
   depend on any single broker.
   ============================================================ */

const Net = (function () {
  let trystero = null;
  let room = null;
  let sendMsg = null;
  let isHost = false;
  let myRoomId = null;          // either generated (host) or supplied (guest)
  let oppPeerId = null;
  let connected = false;

  const handlers = {
    open: [], connected: [], message: [], disconnected: [], error: [], status: [],
  };

  function on(event, fn) {
    (handlers[event] = handlers[event] || []).push(fn);
  }
  function emit(event, ...args) {
    (handlers[event] || []).forEach(fn => {
      try { fn(...args); } catch (e) { console.error(e); }
    });
  }

  // -------- Load Trystero (ESM via esm.sh) --------
  let trysteroPromise = null;
  function loadTrystero() {
    if (trysteroPromise) return trysteroPromise;
    emit('status', 'Loading network…');
    trysteroPromise = (async () => {
      // Primary: esm.sh.  Secondary fallback: jsdelivr esm bundle.
      const sources = [
        'https://esm.sh/trystero@0.21.4/torrent',
        'https://cdn.jsdelivr.net/npm/trystero@0.21.4/+esm',
      ];
      let lastErr = null;
      for (const src of sources) {
        try {
          const mod = await import(/* @vite-ignore */ src);
          if (mod && typeof mod.joinRoom === 'function') {
            trystero = mod;
            return mod;
          }
        } catch (e) {
          lastErr = e;
        }
      }
      throw new Error('Could not load network library: ' + (lastErr?.message || 'unknown'));
    })();
    return trysteroPromise;
  }

  // -------- API matching the previous PeerJS shape --------

  async function init() {
    try {
      await loadTrystero();
    } catch (e) {
      emit('error', e);
      throw e;
    }
    if (!myRoomId) myRoomId = generateRoomCode();
    emit('open', myRoomId);
    return myRoomId;
  }

  async function hostRoom() {
    isHost = true;
    emit('status', 'Opening room. Tell your opponent to join with this code.');
    _setupRoom(myRoomId);
    return myRoomId;
  }

  async function joinRoom(roomId) {
    isHost = false;
    myRoomId = (roomId || '').trim();
    if (!myRoomId) throw new Error('Enter a room code first.');
    if (!trystero) await loadTrystero();
    emit('status', 'Looking for host (this can take up to 30 seconds)…');
    return new Promise((resolve, reject) => {
      let resolved = false;
      const finish = (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        if (err) {
          try { room?.leave(); } catch (_) {}
          room = null;
          reject(err);
        } else {
          resolve();
        }
      };
      const timer = setTimeout(() => {
        finish(new Error(
          `Couldn't find the host within 30 seconds.\n\n` +
          `Things to check:\n` +
          `1. The other player has the page open and clicked "Create room".\n` +
          `2. The code "${myRoomId}" is shown on their screen right now.\n` +
          `3. You both have a working internet connection.`
        ));
      }, 30000);
      // One-shot connection waiter.
      const onceConnected = () => finish(null);
      handlers.connected.push(onceConnected);
      _setupRoom(myRoomId);
    });
  }

  function _setupRoom(code) {
    if (room) {
      try { room.leave(); } catch (_) {}
      room = null;
    }
    const config = {
      appId: 'coup-coen-buijs-2026-v1',
      rtcConfig: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' },
        ],
      },
    };
    room = trystero.joinRoom(config, code);
    const [s, g] = room.makeAction('msg');
    sendMsg = s;
    g((data /*, peerId */) => emit('message', data));
    room.onPeerJoin((peerId) => {
      oppPeerId = peerId;
      connected = true;
      emit('status', 'Connected!');
      emit('connected', isHost);
    });
    room.onPeerLeave((peerId) => {
      if (peerId === oppPeerId) {
        connected = false;
        emit('disconnected');
      }
    });
  }

  function send(msg) {
    try {
      if (sendMsg) sendMsg(msg);
    } catch (e) {
      console.warn('send failed', e);
    }
  }

  function getRole() { return isHost ? 'host' : 'guest'; }

  function generateRoomCode() {
    const adj  = ['red','blue','gold','dark','wild','swift','calm','keen','vast','bold','quiet','silver','royal','iron','jade'];
    const noun = ['fox','wolf','duke','lion','crow','sage','tide','moon','rook','spire','raven','star','vault','blade','torch'];
    const a = adj[Math.floor(Math.random() * adj.length)];
    const n = noun[Math.floor(Math.random() * noun.length)];
    const num = Math.floor(Math.random() * 900) + 100;
    return `coup-${a}-${n}-${num}`;
  }

  return { init, hostRoom, joinRoom, send, on, getRole };
})();
