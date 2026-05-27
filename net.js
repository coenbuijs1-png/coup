/* ============================================================
   COUP - Networking

   Uses two signaling paths with the same room code:
   1. PeerJS public broker, which is simple and used to work for this app.
   2. Trystero torrent signaling as a fallback if PeerJS cannot connect.

   The first transport that reaches the opponent becomes active.
   ============================================================ */

const Net = (function () {
  const APP_ID = 'coup-coen-buijs-2026-v2';

  const PEERJS_SOURCES = [
    'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',
  ];

  const TRYSTERO_SOURCES = [
    'https://esm.sh/@trystero-p2p/torrent@0.23.1',
    'https://cdn.jsdelivr.net/npm/@trystero-p2p/torrent@0.23.1/+esm',
    // Older package name as a last-ditch fallback.
    'https://esm.sh/trystero@0.21.4/torrent',
  ];

  const RTC_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  };

  const TRYSTERO_CONFIG = {
    appId: APP_ID,
    rtcConfig: RTC_CONFIG,
    relayConfig: {
      redundancy: 4,
      urls: [
        'wss://tracker.webtorrent.dev',
        'wss://tracker.openwebtorrent.com',
        'wss://tracker.btorrent.xyz',
        'wss://tracker.files.fm:7073/announce',
      ],
    },
  };

  let PeerCtor = null;
  let trystero = null;

  let peer = null;
  let peerConn = null;
  let trysteroRoom = null;
  let trysteroSend = null;

  let isHost = false;
  let roomId = null;
  let activeTransport = null;
  let activeSend = null;
  let peerReadyPromise = null;
  let trysteroReadyPromise = null;

  const handlers = {
    open: [],
    connected: [],
    message: [],
    disconnected: [],
    error: [],
    status: [],
  };

  function on(event, fn) {
    (handlers[event] = handlers[event] || []).push(fn);
  }

  function emit(event, ...args) {
    (handlers[event] || []).forEach(fn => {
      try { fn(...args); } catch (e) { console.error(e); }
    });
  }

  async function init() {
    if (!roomId) roomId = generateRoomCode();
    emit('open', roomId);
    return roomId;
  }

  async function hostRoom() {
    isHost = true;
    activeTransport = null;
    activeSend = null;
    emit('status', 'Opening room...');

    const hostTasks = [
      startPeerHost(roomId).catch(err => emit('status', 'PeerJS unavailable: ' + shortError(err))),
      startTrysteroRoom(roomId).catch(err => emit('status', 'Trystero unavailable: ' + shortError(err))),
    ];

    await Promise.allSettled(hostTasks);
    emit('status', 'Room open. Keep this tab open and share the code.');
    return roomId;
  }

  async function joinRoom(code) {
    isHost = false;
    roomId = normalizeRoomCode(code);
    if (!roomId) throw new Error('Enter a room code first.');

    activeTransport = null;
    activeSend = null;
    emit('status', 'Looking for host...');

    return new Promise(async (resolve, reject) => {
      const errors = [];
      const timeout = setTimeout(() => {
        cleanupInactiveTransports();
        const details = errors.length ? '\n\nDetails:\n- ' + errors.map(shortError).join('\n- ') : '';
        reject(new Error(
          `Couldn't reach the host for "${roomId}".\n\n` +
          `Check that the host has clicked "Create room", sees this exact code, and keeps that tab open.` +
          details
        ));
      }, 30000);

      const win = (transportName, sendFn) => {
        if (activeTransport) return;
        clearTimeout(timeout);
        activateTransport(transportName, sendFn);
        resolve();
      };

      try {
        await startPeerGuest(roomId, win);
        if (activeTransport) return;
      } catch (err) {
        errors.push('PeerJS: ' + shortError(err));
        stopPeerTransport();
      }

      emit('status', 'PeerJS did not connect. Trying Trystero...');
      try {
        await startTrysteroRoom(roomId, win);
      } catch (err) {
        errors.push('Trystero: ' + shortError(err));
      }
    });
  }

  function send(msg) {
    try {
      activeSend?.(msg);
    } catch (e) {
      emit('error', e);
    }
  }

  function getRole() {
    return isHost ? 'host' : 'guest';
  }

  async function startPeerHost(code) {
    const Peer = await loadPeerJS();
    peer?.destroy?.();
    peer = new Peer(code, { debug: 0, config: RTC_CONFIG });

    await waitForPeerOpen(peer, 'PeerJS host');

    peer.on('connection', conn => {
      if (!isHost) {
        conn.close();
        return;
      }
      if (activeTransport && activeTransport !== 'peerjs') {
        conn.close();
        return;
      }
      wirePeerConn(conn, true);
    });
  }

  async function startPeerGuest(code, onConnected) {
    const Peer = await loadPeerJS();
    const guestPeer = new Peer(undefined, { debug: 0, config: RTC_CONFIG });
    peer = guestPeer;

    await waitForPeerOpen(guestPeer, 'PeerJS guest');
    emit('status', 'Trying PeerJS...');

    return new Promise((resolve, reject) => {
      const conn = guestPeer.connect(code, { reliable: true });
      const timer = setTimeout(() => {
        reject(new Error('PeerJS timed out'));
      }, 12000);

      conn.on('open', () => {
        clearTimeout(timer);
        wirePeerConn(conn, false, onConnected);
        resolve();
      });
      conn.on('error', err => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function wirePeerConn(conn, incoming, onConnected) {
    peerConn = conn;
    const useConn = () => {
      const sendFn = data => conn.open && conn.send(data);
      if (onConnected) {
        onConnected('peerjs', sendFn);
      } else {
        activateTransport('peerjs', sendFn);
      }
    };

    conn.on('open', useConn);
    if (conn.open) useConn();

    conn.on('data', data => {
      if (activeTransport === 'peerjs') emit('message', data);
    });
    conn.on('close', () => {
      if (activeTransport === 'peerjs') emit('disconnected');
    });
    conn.on('error', err => emit('error', err));
  }

  async function startTrysteroRoom(code, onConnected) {
    const mod = await loadTrystero();
    emit('status', activeTransport ? 'Connected.' : 'Trying Trystero...');

    trysteroRoom?.leave?.();
    trysteroRoom = mod.joinRoom(TRYSTERO_CONFIG, code, {
      onJoinError: details => emit('error', new Error(details?.error || 'Trystero join error')),
      handshakeTimeoutMs: 15000,
    });

    const action = trysteroRoom.makeAction('msg');
    const sendFn = Array.isArray(action) ? action[0] : action.send;
    const receiveFn = Array.isArray(action) ? action[1] : action.onMessage;
    trysteroSend = data => sendFn(data);

    receiveFn((data) => {
      if (activeTransport === 'trystero') emit('message', data);
    });

    trysteroRoom.onPeerJoin(peerId => {
      const trysteroSender = data => trysteroSend(data, peerId);
      if (onConnected) {
        onConnected('trystero', trysteroSender);
      } else {
        activateTransport('trystero', trysteroSender);
      }
    });

    trysteroRoom.onPeerLeave(() => {
      if (activeTransport === 'trystero') emit('disconnected');
    });
  }

  function activateTransport(name, sendFn) {
    if (activeTransport) return;
    activeTransport = name;
    activeSend = sendFn;
    emit('status', `Connected via ${name}.`);
    emit('connected', isHost);
    cleanupInactiveTransports();
  }

  function cleanupInactiveTransports() {
    if (activeTransport !== 'trystero') {
      try { trysteroRoom?.leave?.(); } catch (_) {}
      trysteroRoom = null;
      trysteroSend = null;
    }
    if (activeTransport !== 'peerjs') {
      stopPeerTransport();
    }
  }

  function stopPeerTransport() {
    try { peerConn?.close?.(); } catch (_) {}
    try { peer?.destroy?.(); } catch (_) {}
    peerConn = null;
    peer = null;
  }

  function loadPeerJS() {
    if (PeerCtor) return Promise.resolve(PeerCtor);
    if (peerReadyPromise) return peerReadyPromise;

    emit('status', 'Loading PeerJS...');
    peerReadyPromise = loadScriptSources(PEERJS_SOURCES).then(() => {
      if (!window.Peer) throw new Error('PeerJS loaded but window.Peer is missing');
      PeerCtor = window.Peer;
      return PeerCtor;
    });
    return peerReadyPromise;
  }

  function loadTrystero() {
    if (trystero) return Promise.resolve(trystero);
    if (trysteroReadyPromise) return trysteroReadyPromise;

    emit('status', 'Loading Trystero...');
    trysteroReadyPromise = (async () => {
      let lastErr = null;
      for (const src of TRYSTERO_SOURCES) {
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
      throw new Error('Could not load Trystero: ' + shortError(lastErr));
    })();
    return trysteroReadyPromise;
  }

  function loadScriptSources(sources) {
    return sources.reduce((chain, src) => {
      return chain.catch(() => loadScript(src));
    }, Promise.reject(new Error('no source tried')));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-net-src="${src}"]`);
      if (existing?.dataset.loaded === 'true') {
        resolve();
        return;
      }

      const script = existing || document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.netSrc = src;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error('Failed loading ' + src));
      if (!existing) document.head.appendChild(script);
    });
  }

  function waitForPeerOpen(peerInstance, label) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        err ? reject(err) : resolve(peerInstance.id);
      };
      const timer = setTimeout(() => finish(new Error(label + ' open timed out')), 10000);
      peerInstance.on('open', () => finish(null));
      peerInstance.on('error', err => finish(err));
    });
  }

  function normalizeRoomCode(value) {
    return (value || '').trim().toLowerCase();
  }

  function shortError(err) {
    if (!err) return 'unknown error';
    if (typeof err === 'string') return err;
    return err.message || err.type || String(err);
  }

  function generateRoomCode() {
    const adj = ['red','blue','gold','dark','wild','swift','calm','keen','vast','bold','quiet','silver','royal','iron','jade'];
    const noun = ['fox','wolf','duke','lion','crow','sage','tide','moon','rook','spire','raven','star','vault','blade','torch'];
    const a = adj[Math.floor(Math.random() * adj.length)];
    const n = noun[Math.floor(Math.random() * noun.length)];
    const num = Math.floor(Math.random() * 900) + 100;
    return `coup-${a}-${n}-${num}`;
  }

  return { init, hostRoom, joinRoom, send, on, getRole };
})();
