import { io } from 'socket.io-client';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

export class MeshRTC {
  constructor({ signalingUrl, localStream, onPeerStream, onPeerLeft, onPeerJoined, maxPeers = 4 }) {
    this.signalingUrl = signalingUrl;
    this.socket = io(signalingUrl);
    this.localStream = localStream;
    this.onPeerStream = onPeerStream;
    this.onPeerLeft = onPeerLeft;
    this.onPeerJoined = onPeerJoined;
    this.maxPeers = maxPeers;

    /** @type {Map<string, RTCPeerConnection>} */
    this.peers = new Map();
    /** @type {Map<string, RTCDataChannel>} */
    this.dataChannels = new Map();
    /** Buffer ICE candidates until remoteDescription is set */
    this.candidateBuffer = new Map();

    this._bindSocket();
  }

  _bindSocket() {
    this.socket.on('connect', () => {
      console.log('Signaling connected', this.socket.id);
    });
    this.socket.on('error-message', (msg) => alert(msg));
    this.socket.on('room-full', ({ roomId, max }) => alert(`Room ${roomId} is full (max ${max}).`));

    this.socket.on('peers', (peers) => {
      // Initiator for existing peers
      peers.forEach(({ id, name }) => {
        this._createConnection(id, true, name);
      });
    });

    this.socket.on('peer-joined', ({ id, name }) => {
      if (this.onPeerJoined) this.onPeerJoined({ id, name });
      // Non-initiator for new peers
      this._createConnection(id, false, name);
    });

    this.socket.on('signal', async ({ from, type, data }) => {
      const pc = this.peers.get(from);
      if (!pc) return; // might be closed

      if (type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket.emit('signal', { to: from, type: 'answer', data: answer });

        // Flush buffered ICE once remoteDescription is set
        this._flushBufferedCandidates(from);

      } else if (type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        this._flushBufferedCandidates(from);
      } else if (type === 'ice-candidate') {
        if (pc.remoteDescription) {
          try { await pc.addIceCandidate(data); } catch {}
        } else {
          const buf = this.candidateBuffer.get(from) || [];
          buf.push(data);
          this.candidateBuffer.set(from, buf);
        }
      }
    });

    this.socket.on('peer-left', ({ id }) => {
      this._closePeer(id);
      if (this.onPeerLeft) this.onPeerLeft(id);
    });
  }

  _flushBufferedCandidates(peerId) {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    const buf = this.candidateBuffer.get(peerId) || [];
    this.candidateBuffer.delete(peerId);
    buf.forEach(async (c) => {
      try { await pc.addIceCandidate(c); } catch {}
    });
  }

  async join(roomId, name) {
    this.roomId = roomId;
    this.name = name;
    this.socket.emit('join', { roomId, name });
  }

  _createConnection(peerId, isInitiator, peerName='Peer') {
    if (this.peers.has(peerId)) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(peerId, pc);

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
    }

    // Remote tracks
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      this.onPeerStream && this.onPeerStream(peerId, stream, peerName);
    };

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal', { to: peerId, type: 'ice-candidate', data: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      // console.log(peerId, 'state', pc.connectionState);
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        this._closePeer(peerId);
      }
    };

    // Data channel (optional chat/ctrl)
    let dc;
    if (isInitiator) {
      dc = pc.createDataChannel('chat');
      this._setupDataChannel(peerId, dc);
    } else {
      pc.ondatachannel = (e) => this._setupDataChannel(peerId, e.channel);
    }

    // Negotiation
    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.socket.emit('signal', { to: peerId, type: 'offer', data: offer });
        } catch (e) {
          console.error('negotiation error', e);
        }
      };
    }

    return pc;
  }

  _setupDataChannel(peerId, dc) {
    this.dataChannels.set(peerId, dc);
    dc.onopen = () => { /* console.log('dc open to', peerId) */ };
    dc.onmessage = (e) => {
      // could be used later
      // console.log('dc message from', peerId, e.data)
    };
    dc.onclose = () => this.dataChannels.delete(peerId);
  }

  async replaceTrack(kind, track) {
    // Replace local track (e.g., toggle camera/screen share)
    this.localStream.getTracks().forEach(t => {
      if (t.kind === kind) t.stop();
    });
    const senders = [];
    for (const [, pc] of this.peers) {
      pc.getSenders().forEach(s => { if (s.track && s.track.kind === kind) senders.push(s); });
    }
    senders.forEach(s => s.replaceTrack(track));
  }

  _closePeer(peerId) {
    const pc = this.peers.get(peerId);
    if (pc) {
      try { pc.close(); } catch {}
      this.peers.delete(peerId);
    }
    const dc = this.dataChannels.get(peerId);
    if (dc) {
      try { dc.close(); } catch {}
      this.dataChannels.delete(peerId);
    }
    this.candidateBuffer.delete(peerId);
  }

  closeAll() {
    for (const [id] of this.peers) this._closePeer(id);
    this.socket?.close();
  }
}
