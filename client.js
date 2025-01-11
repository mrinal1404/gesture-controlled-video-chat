let localStream;
let remoteStream;
let peerConnection;
let socket; // Global declaration
let hands;
const roomId = "default-room";
const userId = Math.random().toString(36).substr(2, 9);

const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:your-turn-server.com", // Replace with a valid TURN server
      username: "username",
      credential: "password",
    },
  ],
};

// Initialize MediaPipe Hands
async function initializeHandTracking() {
  hands = new Hands({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    },
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  hands.onResults(onHandsResults);
}

// Process hand tracking results
function onHandsResults(results) {
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const gesture = detectGesture(results.multiHandLandmarks[0]);
    if (gesture && socket) {
      socket.emit("gesture", gesture); // Only emit if socket is initialized
      showGestureIndicator(gesture);
    }
  }
}

// Detect gestures based on hand landmarks
function detectGesture(landmarks) {
  if (!landmarks) return null;

  // Thumb up detection
  const thumbTip = landmarks[4];
  const thumbBase = landmarks[2];
  if (thumbTip.y < thumbBase.y) {
    return "thumbs-up";
  }

  // Wave detection
  const wristY = landmarks[0].y;
  const fingertipsY = landmarks[8].y;
  if (Math.abs(wristY - fingertipsY) > 0.3) {
    return "wave";
  }

  return null;
}

// Show gesture indicator
function showGestureIndicator(gesture) {
  const indicator = document.getElementById("gestureIndicator");
  if (indicator) {
    indicator.textContent = `Gesture Detected: ${gesture}`;
    indicator.style.display = "block";
    setTimeout(() => {
      indicator.style.display = "none";
    }, 2000);
  }
}

// Initialize WebRTC
async function initializeCall() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    document.getElementById("localVideo").srcObject = localStream;

    // Initialize Socket.IO connection
    socket = io("http://localhost:3000");

    // Emit join-room event after socket connection
    socket.on("connect", () => {
      socket.emit("join-room", roomId, userId);

      // Event for user connection
      socket.on("user-connected", (userId) => {
        console.log("User connected:", userId);
        createOffer();
      });

      // Handle gestures received from remote users
      socket.on("gesture-received", (gesture) => {
        showGestureIndicator(`Received: ${gesture}`);
      });

      // Handle WebRTC signaling
      setupSocketSignaling();
    });

    initializePeerConnection();
    initializeHandTracking();
  } catch (error) {
    console.error("Error initializing call:", error);
  }
}

function setupSocketSignaling() {
  // Handle incoming ICE candidates
  socket.on("ice-candidate", (candidate) => {
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  });

  // Handle incoming offer
  socket.on("offer", async (offer) => {
    try {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer),
      );
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit("answer", answer);
    } catch (error) {
      console.error("Error handling offer:", error);
    }
  });

  // Handle incoming answer
  socket.on("answer", async (answer) => {
    try {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer),
      );
    } catch (error) {
      console.error("Error handling answer:", error);
    }
  });
}

function initializePeerConnection() {
  peerConnection = new RTCPeerConnection(iceServers);

  // Add local tracks to peer connection
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  // Handle incoming tracks
  peerConnection.ontrack = (event) => {
    if (!remoteStream) {
      remoteStream = new MediaStream();
      document.getElementById("remoteVideo").srcObject = remoteStream;
    }
    remoteStream.addTrack(event.track);
  };

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", event.candidate);
    }
  };
}

async function createOffer() {
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("offer", offer);
  } catch (error) {
    console.error("Error creating offer:", error);
  }
}

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("startButton")
    .addEventListener("click", initializeCall);

  document.getElementById("muteButton").addEventListener("click", () => {
    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    document.getElementById("muteButton").textContent = audioTrack.enabled
      ? "Mute"
      : "Unmute";
  });

  document.getElementById("videoButton").addEventListener("click", () => {
    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
    document.getElementById("videoButton").textContent = videoTrack.enabled
      ? "Video Off"
      : "Video On";
  });
});
