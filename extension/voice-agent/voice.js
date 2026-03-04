/**
 * Nova Voice Agent — Browser client
 *
 * Captures microphone audio at 16 kHz mono PCM, streams to backend
 * via Socket.IO, and plays back 24 kHz PCM audio from Nova Sonic.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BACKEND_URL = "http://98.91.240.78";
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const CHUNK_SIZE = 512; // samples per audio processing frame

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let socket = null;
let mediaStream = null;
let audioContext = null;
let processorNode = null;
let sourceNode = null;
let playbackCtx = null;
let playbackQueue = [];
let isPlaying = false;
let isSessionActive = false;

// DOM elements
const micBtn = document.getElementById("micBtn");
const stopBtn = document.getElementById("stopBtn");
const voiceSelect = document.getElementById("voiceSelect");
const statusBadge = document.getElementById("statusBadge");
const stateLabel = document.getElementById("stateLabel");
const orb = document.getElementById("orb");
const orbInner = document.getElementById("orbInner");
const transcript = document.getElementById("transcript");
const toolBar = document.getElementById("toolBar");
const toolText = document.getElementById("toolText");

// ---------------------------------------------------------------------------
// Socket.IO setup — client is bundled with the extension
// ---------------------------------------------------------------------------
async function connectSocket() {
  /* global io */
  socket = io(BACKEND_URL + "/voice", {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 5,
  });

  socket.on("connect", () => {
    console.log("[Voice] Socket connected:", socket.id);
    setStatus("connected", "Connected");
  });

  socket.on("disconnect", () => {
    console.log("[Voice] Socket disconnected");
    setStatus("", "Disconnected");
    endSession();
  });

  socket.on("audioOutput", (base64Audio) => {
    queueAudioForPlayback(base64Audio);
    setOrbState("speaking");
  });

  socket.on("textOutput", (data) => {
    if (data.role === "ASSISTANT" || data.role === "assistant") {
      appendTranscript("assistant", data.text);
    } else if (data.role === "USER" || data.role === "user") {
      appendTranscript("user", data.text);
    }
  });

  socket.on("toolStart", (data) => {
    toolBar.hidden = false;
    toolText.textContent = `Running: ${data.toolName}...`;
    setOrbState("thinking");
  });

  socket.on("toolEnd", (data) => {
    toolBar.hidden = true;
  });

  socket.on("toolAction", (data) => {
    console.log("[Voice] Tool action received:", data);
    handleToolAction(data);
  });

  socket.on("error", (data) => {
    console.error("[Voice] Server error:", data.message);
    appendTranscript("system", "Error: " + data.message);
    setStatus("error", "Error");
  });
}

// ---------------------------------------------------------------------------
// Audio Capture — microphone → 16kHz mono PCM → base64 → Socket.IO
// ---------------------------------------------------------------------------
async function startAudioCapture() {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: INPUT_SAMPLE_RATE,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  audioContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  processorNode = audioContext.createScriptProcessor(CHUNK_SIZE, 1, 1);

  processorNode.onaudioprocess = (e) => {
    if (!isSessionActive || !socket) return;

    const float32 = e.inputBuffer.getChannelData(0);
    // Convert float32 [-1, 1] to int16 PCM
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    // Base64 encode
    const bytes = new Uint8Array(int16.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    socket.emit("audioInput", base64);
  };

  sourceNode.connect(processorNode);
  processorNode.connect(audioContext.destination);
}

function stopAudioCapture() {
  if (processorNode) {
    processorNode.disconnect();
    processorNode = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
}

// ---------------------------------------------------------------------------
// Audio Playback — base64 PCM 24kHz → AudioContext → speaker
// ---------------------------------------------------------------------------
function queueAudioForPlayback(base64Audio) {
  // Decode base64 → Int16 → Float32
  const binaryStr = atob(base64Audio);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }

  playbackQueue.push(float32);
  if (!isPlaying) {
    playNextChunk();
  }
}

function playNextChunk() {
  if (playbackQueue.length === 0) {
    isPlaying = false;
    // Back to listening state after playback finishes
    if (isSessionActive) {
      setOrbState("listening");
      setStatus("listening", "Listening...");
    }
    return;
  }

  isPlaying = true;

  if (!playbackCtx) {
    playbackCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
  }

  const samples = playbackQueue.shift();
  const buffer = playbackCtx.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
  buffer.getChannelData(0).set(samples);

  const source = playbackCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackCtx.destination);
  source.onended = () => playNextChunk();
  source.start();
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------
async function startSession() {
  if (isSessionActive) return;

  try {
    setStatus("", "Connecting...");
    stateLabel.textContent = "Connecting to Nova Sonic...";

    if (!socket || !socket.connected) {
      await connectSocket();
    }

    await startAudioCapture();

    const voiceId = voiceSelect.value;

    // Start the Nova Sonic session
    await new Promise((resolve, reject) => {
      socket.emit("startSession", { voiceId }, (response) => {
        if (response.status === "ok") resolve();
        else reject(new Error(response.message || "Failed to start session"));
      });
    });

    isSessionActive = true;
    micBtn.classList.add("active");
    micBtn.hidden = true;
    stopBtn.hidden = false;
    voiceSelect.disabled = true;

    setOrbState("listening");
    setStatus("listening", "Listening...");
    stateLabel.textContent = "Listening — speak naturally";

    // Clear transcript
    transcript.innerHTML = "";
    appendTranscript("system", "Voice session started. Say something!");

    console.log("[Voice] Session started with voice:", voiceId);
  } catch (err) {
    console.error("[Voice] Failed to start session:", err);
    setStatus("error", "Error");
    stateLabel.textContent = "Failed: " + err.message;
    stopAudioCapture();
  }
}

async function endSession() {
  if (!isSessionActive) return;
  isSessionActive = false;

  stopAudioCapture();

  // Clear playback
  playbackQueue = [];
  isPlaying = false;
  if (playbackCtx) {
    playbackCtx.close();
    playbackCtx = null;
  }

  if (socket && socket.connected) {
    socket.emit("endSession");
  }

  micBtn.classList.remove("active");
  micBtn.hidden = false;
  stopBtn.hidden = true;
  voiceSelect.disabled = false;

  setOrbState("");
  setStatus("connected", "Connected");
  stateLabel.textContent = "Press the microphone to start";
  toolBar.hidden = true;

  appendTranscript("system", "Session ended.");
  console.log("[Voice] Session ended");
}

// ---------------------------------------------------------------------------
// Tool action handler — dispatches actions to the extension
// ---------------------------------------------------------------------------
function handleToolAction(data) {
  // Send message to the extension's background worker to execute the action
  if (typeof chrome !== "undefined" && chrome.runtime) {
    switch (data.action) {
      case "smart_search":
        chrome.runtime.sendMessage({
          type: "VOICE_SMART_SEARCH",
          query: data.query,
        });
        appendTranscript("system", `Searching: "${data.query}"`);
        break;

      case "try_on":
        chrome.runtime.sendMessage({
          type: "VOICE_TRY_ON",
          productTitle: data.productTitle,
          productUrl: data.productUrl,
        });
        appendTranscript("system", `Try-on: "${data.productTitle}"`);
        break;

      case "build_outfit":
        chrome.runtime.sendMessage({
          type: "VOICE_BUILD_OUTFIT",
          top: data.top,
          bottom: data.bottom,
          shoes: data.shoes,
        });
        appendTranscript("system", `Building outfit: ${data.top} + ${data.bottom}`);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function setStatus(className, text) {
  statusBadge.className = "va-status" + (className ? " " + className : "");
  statusBadge.textContent = text;
}

function setOrbState(state) {
  orb.className = "va-orb" + (state ? " " + state : "");
}

function appendTranscript(role, text) {
  if (!text || !text.trim()) return;

  // Remove placeholder
  const placeholder = transcript.querySelector(".va-transcript-placeholder");
  if (placeholder) placeholder.remove();

  const msg = document.createElement("div");
  msg.className = "va-msg " + role;
  msg.textContent = text;
  transcript.appendChild(msg);
  transcript.scrollTop = transcript.scrollHeight;
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
micBtn.addEventListener("click", startSession);
stopBtn.addEventListener("click", endSession);

// Keyboard shortcut: Space to toggle
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target === document.body) {
    e.preventDefault();
    if (isSessionActive) endSession();
    else startSession();
  }
});

// Cleanup on page unload
window.addEventListener("unload", () => {
  stopAudioCapture();
  if (playbackCtx) playbackCtx.close();
  if (socket) socket.disconnect();
});

// Initialize connection on load
connectSocket().catch((err) => {
  console.error("[Voice] Initial connection failed:", err);
  stateLabel.textContent = "Cannot connect to backend. Is the server running?";
  setStatus("error", "Offline");
});
