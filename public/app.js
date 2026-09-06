const socket = io();

let roomId = "main";
let player = null;

let playerReady = false;
let suppressEvents = false;
let lastSync = 0;

const dropZone = document.getElementById("dropZone");
const youtubeUrl = document.getElementById("youtubeUrl");
const loadYoutube = document.getElementById("loadYoutube");

const syncStatus = document.getElementById("syncStatus");
const videoStatus = document.getElementById("videoStatus");

const messages = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");

const username = document.getElementById("username");
const message = document.getElementById("message");

document.getElementById("roomId").textContent = roomId;


/* =========================
   YouTube
========================= */

window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player("player", {
        width: "100%",
        height: "100%",
        videoId: "",
        playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            modestbranding: 1
        },

        events: {
            onReady: () => {
                playerReady = true;
                console.log("YouTube player ready");
            },

            onStateChange: handlePlayerState
        }
    });
};


function handlePlayerState(event) {

    if (!playerReady || suppressEvents) return;

    const currentTime = player.getCurrentTime();

    if (event.data === YT.PlayerState.PLAYING) {

        socket.emit("video-play", {
            roomId,
            time: currentTime
        });

    }

    if (event.data === YT.PlayerState.PAUSED) {

        socket.emit("video-pause", {
            roomId,
            time: currentTime
        });

    }
}


/* =========================
   YouTube URL
========================= */

function extractYouTubeId(url) {

    try {

        const parsed = new URL(url);

        if (
            parsed.hostname.includes("youtube.com") ||
            parsed.hostname.includes("www.youtube.com")
        ) {

            if (parsed.pathname === "/watch") {
                return parsed.searchParams.get("v");
            }

            if (parsed.pathname.startsWith("/shorts/")) {
                return parsed.pathname.split("/")[2];
            }

            if (parsed.pathname.startsWith("/embed/")) {
                return parsed.pathname.split("/")[2];
            }

        }

        if (
            parsed.hostname === "youtu.be" ||
            parsed.hostname === "www.youtu.be"
        ) {

            return parsed.pathname.substring(1).split("/")[0];

        }

    } catch (error) {
        return null;
    }

    return null;
}


function loadVideoFromUrl(url) {

    const videoId = extractYouTubeId(url);

    if (!videoId) {

        alert("رابط YouTube غير صحيح");

        return;
    }

    socket.emit("video-load", {
        roomId,
        videoId
    });
}


loadYoutube.addEventListener("click", () => {

    const url = youtubeUrl.value.trim();

    if (!url) return;

    loadVideoFromUrl(url);

});


youtubeUrl.addEventListener("keydown", (event) => {

    if (event.key === "Enter") {

        loadVideoFromUrl(youtubeUrl.value.trim());

    }

});


/* =========================
   Drag & Drop
========================= */

dropZone.addEventListener("dragover", (event) => {

    event.preventDefault();

    dropZone.classList.add("dragover");

});


dropZone.addEventListener("dragleave", () => {

    dropZone.classList.remove("dragover");

});


dropZone.addEventListener("drop", (event) => {

    event.preventDefault();

    dropZone.classList.remove("dragover");

    const text =
        event.dataTransfer.getData("text/uri-list") ||
        event.dataTransfer.getData("text/plain");

    if (!text) {

        alert("لم يتم العثور على رابط YouTube");

        return;
    }

    youtubeUrl.value = text.trim();

    loadVideoFromUrl(text.trim());

});


/* =========================
   Socket connection
========================= */

socket.on("connect", () => {

    syncStatus.textContent = "● متصل";

    socket.emit("join-room", roomId);

});


socket.on("disconnect", () => {

    syncStatus.textContent = "● غير متصل";

});


/* =========================
   Room state
========================= */

socket.on("room-state", (state) => {

    if (!state.video) return;

    loadRemoteVideo(
        state.video,
        state.time,
        state.playing
    );

});


/* =========================
   Load video
========================= */

socket.on("video-load", (data) => {

    loadRemoteVideo(
        data.videoId,
        data.time,
        data.playing
    );

});


function loadRemoteVideo(videoId, time, playing) {

    videoStatus.textContent =
        "YouTube: " + videoId;

    if (!playerReady || !player) return;

    suppressEvents = true;

    player.loadVideoById({
        videoId: videoId,
        startSeconds: time || 0
    });

    setTimeout(() => {

        suppressEvents = false;

        if (playing) {
            player.playVideo();
        } else {
            player.pauseVideo();
        }

    }, 800);

}


/* =========================
   Play
========================= */

socket.on("video-play", (data) => {

    if (!playerReady || !player) return;

    suppressEvents = true;

    player.seekTo(data.time, true);
    player.playVideo();

    setTimeout(() => {
        suppressEvents = false;
    }, 500);

});


/* =========================
   Pause
========================= */

socket.on("video-pause", (data) => {

    if (!playerReady || !player) return;

    suppressEvents = true;

    player.seekTo(data.time, true);
    player.pauseVideo();

    setTimeout(() => {
        suppressEvents = false;
    }, 500);

});


/* =========================
   Seek detection
========================= */

setInterval(() => {

    if (!playerReady || !player) return;

    const state = player.getPlayerState();

    if (state !== YT.PlayerState.PLAYING) return;

    const current = player.getCurrentTime();

    if (Math.abs(current - lastSync) > 2) {

        socket.emit("video-seek", {
            roomId,
            time: current
        });

    }

    lastSync = current;

}, 1000);


socket.on("video-seek", (data) => {

    if (!playerReady || !player) return;

    suppressEvents = true;

    player.seekTo(data.time, true);

    setTimeout(() => {
        suppressEvents = false;
    }, 300);

});


/* =========================
   Fullscreen
========================= */

document
    .getElementById("fullscreenBtn")
    .addEventListener("click", () => {

        const container =
            document.querySelector(".video-container");

        if (!document.fullscreenElement) {

            container.requestFullscreen();

        } else {

            document.exitFullscreen();

        }

    });


/* =========================
   Chat
========================= */

chatForm.addEventListener("submit", (event) => {

    event.preventDefault();

    const text = message.value.trim();

    if (!text) return;

    socket.emit("chat-message", {

        roomId,

        username:
            username.value.trim() ||
            "Guest",

        message: text

    });

    message.value = "";

});


socket.on("chat-message", (data) => {

    const div =
        document.createElement("div");

    div.className = "message";

    const name =
        document.createElement("div");

    name.className = "message-name";

    name.textContent =
        data.username;

    const text =
        document.createElement("div");

    text.className = "message-text";

    text.textContent =
        data.message;

    div.appendChild(name);
    div.appendChild(text);

    messages.appendChild(div);

    messages.scrollTop =
        messages.scrollHeight;

});