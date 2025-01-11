let localStream;
let remoteStream;
let peerConnection;
let socket;
let hands;
let roomId = null;
let userId = Math.random().toString(36).substr(2, 9);

// Constants for gesture detection
const GESTURE_CONFIDENCE_THRESHOLD = 0.7;
const GESTURE_FRAMES_THRESHOLD = 10;
const FINGER_ANGLES = {
    STRAIGHT: 160,
    BENT: 90,
};

// Gesture detection state
let gestureFrameCount = {};
let lastDetectedGesture = null;
let gestureTimeout = null;

const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
            urls: 'turn:your-turn-server.com',
            username: 'username',
            credential: 'password'
        }
    ]
};

// Gesture Helper Functions
function calculateAngle(p1, p2, p3) {
    const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) -
                   Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return angle;
}

function calculateDistance(p1, p2) {
    return Math.sqrt(
        Math.pow(p2.x - p1.x, 2) + 
        Math.pow(p2.y - p1.y, 2) + 
        Math.pow(p2.z - p1.z, 2)
    );
}

function isFingerExtended(finger, landmarks) {
    const tipIndex = finger * 4 + 1;
    const angles = [];
    
    for (let i = 0; i < 3; i++) {
        const angle = calculateAngle(
            landmarks[tipIndex + i],
            landmarks[tipIndex + i + 1],
            landmarks[tipIndex + i + 2]
        );
        angles.push(angle);
    }
    
    return angles.every(angle => angle > FINGER_ANGLES.STRAIGHT);
}

// Enhanced gesture detection
function detectGesture(landmarks) {
    if (!landmarks || landmarks.length === 0) return null;

    const palmCenter = {
        x: (landmarks[0].x + landmarks[5].x + landmarks[17].x) / 3,
        y: (landmarks[0].y + landmarks[5].y + landmarks[17].y) / 3,
        z: (landmarks[0].z + landmarks[5].z + landmarks[17].z) / 3
    };

    const fingers = {
        thumb: isFingerExtended(0, landmarks),
        index: isFingerExtended(1, landmarks),
        middle: isFingerExtended(2, landmarks),
        ring: isFingerExtended(3, landmarks),
        pinky: isFingerExtended(4, landmarks)
    };

    let gesture = null;

    // Thumbs Up
    if (fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky &&
        landmarks[4].y < landmarks[3].y) {
        gesture = 'thumbs-up';
    }
    
    // Thumbs Down
    else if (fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky &&
             landmarks[4].y > landmarks[3].y) {
        gesture = 'thumbs-down';
    }

    // Peace Sign
    else if (!fingers.thumb && fingers.index && fingers.middle && !fingers.ring && !fingers.pinky) {
        const angleBetweenFingers = calculateAngle(
            landmarks[8],
            landmarks[5],
            landmarks[12]
        );
        if (angleBetweenFingers > 30) {
            gesture = 'peace';
        }
    }

    // OK Sign
    else if (fingers.thumb && fingers.index && 
             calculateDistance(landmarks[4], landmarks[8]) < 0.1) {
        gesture = 'ok';
    }

    // Wave
    else if (fingers.thumb && fingers.index && fingers.middle && fingers.ring && fingers.pinky) {
        const horizontalMovement = Math.abs(landmarks[9].x - landmarks[0].x);
        if (horizontalMovement > 0.3) {
            gesture = 'wave';
        }
    }

    // Stop Sign
    else if (fingers.thumb && fingers.index && fingers.middle && fingers.ring && fingers.pinky &&
             Math.abs(landmarks[9].y - landmarks[0].y) < 0.1) {
        gesture = 'stop';
    }

    // Point
    else if (!fingers.thumb && fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
        gesture = 'point';
    }

    // Rock On
    else if (!fingers.thumb && fingers.index && !fingers.middle && !fingers.ring && fingers.pinky) {
        gesture = 'rock';
    }

    return gesture;
}

// Initialize MediaPipe Hands
async function initializeHandTracking() {
    hands = new Hands({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
    });

    hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    hands.onResults(onHandsResults);
}

// Process hand tracking results
function onHandsResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks[0]) {
        const gesture = detectGesture(results.multiHandLandmarks[0]);
        
        if (gesture) {
            gestureFrameCount[gesture] = (gestureFrameCount[gesture] || 0) + 1;
            
            if (gestureFrameCount[gesture] > GESTURE_FRAMES_THRESHOLD &&
                gesture !== lastDetectedGesture) {
                
                socket.emit('gesture', gesture);
                showGestureIndicator(gesture);
                lastDetectedGesture = gesture;
                
                if (gestureTimeout) clearTimeout(gestureTimeout);
                gestureTimeout = setTimeout(() => {
                    lastDetectedGesture = null;
                    gestureFrameCount = {};
                }, 1000);
            }
        } else {
            gestureFrameCount = {};
        }
    }
}

function showGestureIndicator(gesture) {
    const indicator = document.getElementById('gestureIndicator');
    const gestureMessages = {
        'thumbs-up': '👍 Thumbs Up',
        'thumbs-down': '👎 Thumbs Down',
        'peace': '✌️ Peace',
        'ok': '👌 OK',
        'wave': '👋 Wave',
        'stop': '✋ Stop',
        'point': '👆 Point',
        'rock': '🤘 Rock On'
    };

    indicator.textContent = gestureMessages[gesture] || gesture;
    indicator.style.display = 'block';
    indicator.classList.add('gesture-animation');
    
    setTimeout(() => {
        indicator.style.display = 'none';
        indicator.classList.remove('gesture-animation');
    }, 2000);
}

// Room Management Functions
function generateRoomId() {
    return Math.random().toString(36).substr(2, 9);
}

function createRoom() {
    roomId = generateRoomId();
    document.getElementById('roomIdDisplay').textContent = roomId;
    document.getElementById('roomInfo').style.display = 'block';
    initializeCall();
}

function joinRoom() {
    const inputRoomId = document.getElementById('roomInput').value.trim();
    if (inputRoomId) {
        roomId = inputRoomId;
        initializeCall();
    } else {
        alert('Please enter a valid Room ID');
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

async function initializeCall() {
  try {
      localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
      });
      document.getElementById('localVideo').srcObject = localStream;

      socket = io('http://localhost:3000');
      socket.emit('join-room', roomId, userId);

      // Hide room controls and show video controls
      document.querySelector('.room-controls').style.display = 'none';
      document.querySelector('.video-grid').style.display = 'grid';
      document.querySelector('.controls').style.display = 'flex';

      initializePeerConnection();
      initializeHandTracking();

      socket.on('user-connected', (userId) => {
          console.log('User connected:', userId);
          createOffer();
      });

      socket.on('gesture-received', (gesture) => {
          showGestureIndicator(`Received: ${gesture}`);
      });

  } catch (error) {
      console.error('Error initializing call:', error);
      alert('Error accessing camera/microphone. Please ensure permissions are granted.');
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
  
  document.getElementById('createRoomBtn').addEventListener('click', createRoom);
  document.getElementById('joinRoomBtn').addEventListener('click', joinRoom);
  document.getElementById('copyRoomId').addEventListener('click', () => {
  navigator.clipboard.writeText(roomId);
  alert('Room ID copied to clipboard!');});
  

      
  });
  //create room

  let roomId = null;

function generateRoomId() {
    return Math.random().toString(36).substr(2, 9);
}

function createRoom() {
    roomId = generateRoomId();
    document.getElementById('roomIdDisplay').textContent = roomId;
    document.getElementById('roomInfo').style.display = 'block';
    initializeCall();
}

function joinRoom() {
    const inputRoomId = document.getElementById('roomInput').value.trim();
    if (inputRoomId) {
        roomId = inputRoomId;
        initializeCall();
    } else {
        alert('Please enter a valid Room ID');
    }
}

document.getElementById('createRoomBtn').addEventListener('click', createRoom);
document.getElementById('joinRoomBtn').addEventListener('click', joinRoom);
document.getElementById('copyRoomId').addEventListener('click', () => {
    navigator.clipboard.writeText(roomId);
    alert('Room ID copied to clipboard!');
});
});


