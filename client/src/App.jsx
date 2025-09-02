import React, { useEffect, useRef, useState } from "react";
import "./app.css";
import { MeshRTC } from "./webrtc";

const SIGNALING_URL =  import.meta.env.VITE_URL || "https://meshrtc-wetrtc-jeki.vercel.app/";

export default function App() {
  const [roomId, setRoomId] = useState("demo");
  const [name, setName] = useState("Host");
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState("");
  const [peers, setPeers] = useState([]); // {id, name}
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const rtcRef = useRef(null);

  const [remoteVideos, setRemoteVideos] = useState([]); // {id, name, stream}

  useEffect(() => {
    return () => {
      rtcRef.current?.closeAll?.();
      localStreamRef.current?.getTracks()?.forEach((t) => t.stop());
    };
  }, []);

  const handleJoin = async () => {
    try {
      setStatus("Requesting media...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      setStatus("Connecting signaling...");
      const rtc = new MeshRTC({
        signalingUrl: SIGNALING_URL,
        localStream: stream,
        onPeerStream: (id, stream, peerName) => {
          setRemoteVideos((prev) => {
            // add or replace
            const exists = prev.find((v) => v.id === id);
            if (exists) {
              return prev.map((v) => (v.id === id ? { ...v, stream } : v));
            }
            return [...prev, { id, name: peerName || "Peer", stream }];
          });
        },
        onPeerLeft: (id) => {
          setRemoteVideos((prev) => prev.filter((v) => v.id !== id));
          setPeers((prev) => prev.filter((p) => p.id !== id));
        },
        onPeerJoined: ({ id, name }) => {
          setPeers((prev) => {
            const exists = prev.find((p) => p.id === id);
            if (exists) return prev;
            return [...prev, { id, name }];
          });
        },
        maxPeers: 4,
      });
      rtcRef.current = rtc;

      await rtc.join(roomId.trim(), name.trim() || "User");
      setJoined(true);
      setStatus("Joined room.");
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to start");
      setStatus("Error");
    }
  };

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOff(!track.enabled);
  };

  const handleScreenShare = async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      const screenTrack = screenStream.getVideoTracks()[0];
      // Replace outgoing video track
      await rtcRef.current.replaceTrack("video", screenTrack);
      // Also show locally
      const oldStream = localStreamRef.current;
      const newStream = new MediaStream([
        screenTrack,
        ...oldStream.getAudioTracks(),
      ]);
      localStreamRef.current = newStream;
      localVideoRef.current.srcObject = newStream;

      // When screen share stops, switch back to camera
      screenTrack.onended = async () => {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        const camTrack = camStream.getVideoTracks()[0];
        await rtcRef.current.replaceTrack("video", camTrack);
        const merged = new MediaStream([
          camTrack,
          ...newStream.getAudioTracks(),
        ]);
        localStreamRef.current = merged;
        localVideoRef.current.srcObject = merged;
      };
    } catch {}
  };

  return (
    <div className="container">
      {/* <div className="header">
        {!joined ? (
          <>
            <input type="text" value={roomId} onChange={e => setRoomId(e.target.value)} placeholder="Room ID" />
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
            <button className="primary" onClick={handleJoin}>Join</button>
            <span className="status">{status}</span>
          </>
        ) : (
          <>
            <div className="controls">
              <span>Room: <b>{roomId}</b> <span className="badge">{remoteVideos.length + 1} online</span></span>
              <button onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
              <button onClick={toggleCamera}>{cameraOff ? 'Camera On' : 'Camera Off'}</button>
              <button onClick={handleScreenShare}>Share Screen</button>
            </div>
          </>
        )}
      </div> */}

      <div className="header">
        {!joined ? (
          <div className="left">
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="Room ID"
            />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
            <button className="primary" onClick={handleJoin}>
              Join
            </button>
            <span className="status">{status}</span>
          </div>
        ) : (
          <div className="left">
            <div className="controls">
              <span>
                Room: <b>{roomId}</b>{" "}
                <span className="badge">{remoteVideos.length + 1} online</span>
              </span>
              <button onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
              <button onClick={toggleCamera}>
                {cameraOff ? "Camera On" : "Camera Off"}
              </button>
              <button onClick={handleScreenShare}>Share Screen</button>
            </div>
          </div>
        )}
        <div className="right">
          <span className="brand">A Project Created by ARSHAD ALI</span>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <header>Me ({name || "Me"})</header>
          <div className="content">
            <video ref={localVideoRef} autoPlay playsInline muted />
          </div>
        </div>

        {remoteVideos.map(({ id, name, stream }) => (
          <div className="card" key={id}>
            <header>{name || id}</header>
            <div className="content">
              <VideoPlayer stream={stream} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VideoPlayer({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline />;
}
