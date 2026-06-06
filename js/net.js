/* ============================================================
   COUP — Networking (PeerJS, single reliable transport)

   Design notes:
   - PeerJS handles BOTH signaling (its public broker) and the
     WebRTC data channel. This is the configuration that worked
     for this app originally; the later Trystero/BitTorrent
     experiment proved unreliable and has been removed.
   - PeerJS is loaded dynamically from a CDN (with a fallback CDN)
     so index.html stays simple and we never get a version mismatch.
   - Multiple STUN servers improve the odds of a direct connection.
   - getIceServers() is the single place to add TURN later: if a
     global `window.COUP_ICE` array exists, it is used as-is.
   ============================================================ */

const Net = (function () {
  const VERSION = 'net-peerjs-clean-v6';

  const PEERJS_CDN = [
    'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',
  ];

  // STUN servers (free, public). TURN can be injected via window.COUP_ICE.
  const DEFAULT_ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  let PeerCtor = null;
  let peer = null;
  let conn = null;
  let isHost = false;
  let roomId = null;
  let connected = false;

  const handlers = {
    open: [], connected: [], message: [], disconnected: [], error: [], status: [],
  };

  function on(event, fn) { (handlers[event] = handlers[event] || []).push(fn); }
  function emit(event, ...args) {
    (handlers[event] || []).forEach(fn => { try { fn(...args); } catch (e) { console.error(e); } });
  }
  function status(text) { emit('status', text); }

  function getIceServers() {
    if (Array.isArray(window.COUP_ICE) && window.COUP_ICE.length) return window.COUP_ICE;
    return DEFAULT_ICE;
  }

  // -------- Dynamic PeerJS loader (script tag, UMD global `Peer`) --------
  let loadPromise = null;
  function loadPeerJS() {
    if (PeerCtor) return Promise.resolve(PeerCtor);
    if (window.Peer) { PeerCtor = window.Peer; return Promise.resolve(PeerCtor); }
    if (loadPromise) return loadPromise;
    status('Loading network library…');
    loadPromise = new Promise((resolve, reject) => {
      let i = 0;
      const tryNext = () => {
        if (i >= PEERJS_CDN.length) { reject(new Error('Could not load PeerJS from any CDN.')); return; }
        const src = PEERJS_CDN[i++];
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => {
          if (window.Peer) { PeerCtor = window.Peer; resolve(PeerCtor); }
          else tryNext();
        };
        s.onerror = () => tryNext();
        document.head.appendChild(s);
      };
      tryNext();
    });
    return loadPromise;
  }

  function newPeer(id) {
    const opts = { debug: 1, config: { iceServers: getIceServers() } };
    return id ? new PeerCtor(id, opts) : new PeerCtor(opts);
  }

  function waitForPeerOpen(p, label, timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; reject(new Error(label + ' timed out reaching the signaling server.')); } }, timeoutMs);
      p.on('open', (id) => { if (!done) { done = true; clearTimeout(t); resolve(id); } });
      p.on('error', (err) => {
        // 'unavailable-id' is handled by caller; surface others.
        if (done) return;
        if (err && err.type === 'unavailable-id') { done = true; clearTimeout(t); reject(err); return; }
        // network/server errors before open are fatal for this attempt
        if (err && ['network', 'server-error', 'socket-error', 'socket-closed', 'ssl-unavailable', 'browser-incompatible'].includes(err.type)) {
          done = true; clearTimeout(t); reject(new Error('Signaling error: ' + err.type));
        }
      });
    });
  }

  // -------- Public API --------

  async function init() {
    await loadPeerJS();
    if (!roomId) roomId = generateRoomCode();
    emit('open', roomId);
    return roomId;
  }

  async function hostRoom() {
    isHost = true;
    await loadPeerJS();
    status('Opening room…');

    // Try to claim the friendly room code as our Peer ID. On collision, regenerate.
    let attempts = 0;
    while (attempts < 4) {
      attempts++;
      try {
        peer && peer.destroy();
        peer = newPeer(roomId);
        await waitForPeerOpen(peer, 'Host', 12000);
        break;
      } catch (err) {
        if (err && err.type === 'unavailable-id') {
          roomId = generateRoomCode();
          emit('open', roomId); // tell UI the (new) code
          continue;
        }
        throw err;
      }
    }

    // Keep the broker connection alive; reconnect if it drops while waiting.
    peer.on('disconnected', () => {
      if (!connected) { status('Reconnecting to signaling…'); try { peer.reconnect(); } catch (_) {} }
    });

    peer.on('connection', (c) => {
      if (!isHost) { c.close(); return; }
      if (conn && conn.open) { c.close(); return; } // already have an opponent
      wireConn(c);
    });

    status('Room open. Share the code and keep this tab open.');
    return roomId;
  }

  async function joinRoom(code) {
    isHost = false;
    roomId = normalizeCode(code);
    if (!roomId) throw new Error('Enter a room code first.');
    await loadPeerJS();
    status('Connecting to signaling…');

    peer && peer.destroy();
    peer = newPeer(undefined);
    await waitForPeerOpen(peer, 'Join', 12000);

    status('Looking for the host…');
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve();
      };

      // PeerJS fires this on the peer object when the target ID isn't registered.
      const onPeerErr = (err) => {
        if (err && err.type === 'peer-unavailable') {
          finish(new Error(
            `No host found for "${roomId}".\n` +
            `Ask the other player to open the page, click "Create room", and make sure ` +
            `the code shown there matches exactly — and that they keep that tab open.`
          ));
        }
      };
      peer.on('error', onPeerErr);

      const c = peer.connect(roomId, { reliable: true });

      const timer = setTimeout(() => {
        finish(new Error(
          `Couldn't reach the host within 20 seconds.\n` +
          `Most likely the host's tab isn't open on "Create room", or one of you has ` +
          `a network that blocks direct connections (try the same Wi-Fi to test).`
        ));
      }, 20000);

      c.on('open', () => { wireConn(c); finish(null); });
      c.on('error', (err) => {
        if (err && err.type === 'peer-unavailable') { onPeerErr(err); return; }
        finish(err instanceof Error ? err : new Error('Connection error: ' + (err?.type || 'unknown')));
      });
    });
  }

  function wireConn(c) {
    conn = c;
    const markConnected = () => {
      if (connected) return;
      connected = true;
      status('Connected!');
      emit('connected', isHost);
      monitorIce(c);
    };
    if (c.open) markConnected();
    c.on('open', markConnected);
    c.on('data', (data) => emit('message', data));
    c.on('close', () => { connected = false; emit('disconnected'); });
    c.on('error', (err) => emit('error', err));
  }

  // Surface ICE failures (helps diagnose NAT issues).
  function monitorIce(c) {
    try {
      const pc = c.peerConnection;
      if (!pc) return;
      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        if (st === 'failed') {
          status('Direct connection failed (network blocks P2P).');
          emit('error', new Error('ICE failed — a TURN relay is needed for these networks.'));
        }
      };
    } catch (_) {}
  }

  function send(msg) {
    try { if (conn && conn.open) conn.send(msg); } catch (e) { emit('error', e); }
  }

  function getRole() { return isHost ? 'host' : 'guest'; }

  function normalizeCode(code) {
    return (code || '').trim().toLowerCase().replace(/\s+/g, '');
  }

  function generateRoomCode() {
    const adj  = ['red','blue','gold','dark','wild','swift','calm','keen','vast','bold','quiet','silver','royal','iron','jade','amber','onyx','ruby'];
    const noun = ['fox','wolf','duke','lion','crow','sage','tide','moon','rook','spire','raven','star','vault','blade','torch','crown','cobra','hawk'];
    const a = adj[Math.floor(Math.random() * adj.length)];
    const n = noun[Math.floor(Math.random() * noun.length)];
    const num = Math.floor(Math.random() * 900) + 100;
    return `coup-${a}-${n}-${num}`;
  }

  return { init, hostRoom, joinRoom, send, on, getRole, VERSION };
})();
