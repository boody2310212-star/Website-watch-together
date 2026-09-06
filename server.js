const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 10 * 1024
});

const PORT = process.env.PORT || 3000;

const MAX_ROOM_USERS = 50;
const MAX_CHAT_MESSAGE = 500;
const MAX_USERNAME = 32;
const MAX_VIDEO_TIME = 24 * 60 * 60;

// =========================
// Security
// =========================

app.disable("x-powered-by");

app.use(
    helmet({
        contentSecurityPolicy: false
    })
);

app.use(
    express.json({
        limit: "10kb"
    })
);

const httpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false
});

app.use(httpLimiter);

app.use(express.static(path.join(__dirname, "public")));

// =========================
// Rooms
// =========================

const rooms = new Map();

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            video: null,
            playing: false,
            time: 0,
            updatedAt: Date.now()
        });
    }

    return rooms.get(roomId);
}

// =========================
// Validation
// =========================

function validRoomId(roomId) {
    return (
        typeof roomId === "string" &&
        /^[A-Za-z0-9_-]{1,32}$/.test(roomId)
    );
}

function validVideoId(videoId) {
    return (
        typeof videoId === "string" &&
        /^[A-Za-z0-9_-]{11}$/.test(videoId)
    );
}

function validTime(time) {
    const value = Number(time);

    return (
        Number.isFinite(value) &&
        value >= 0 &&
        value <= MAX_VIDEO_TIME
    );
}

function cleanUsername(username) {
    if (typeof username !== "string") {
        return "Guest";
    }

    const cleaned = username
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .trim()
        .slice(0, MAX_USERNAME);

    return cleaned || "Guest";
}

function cleanMessage(message) {
    if (typeof message !== "string") {
        return null;
    }

    const cleaned = message
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .trim()
        .slice(0, MAX_CHAT_MESSAGE);

    return cleaned || null;
}

// =========================
// Socket Rate Limit
// =========================

function allowSocketEvent(socket, eventName, limit, windowMs) {
    const now = Date.now();

    if (!socket.data.rateLimits) {
        socket.data.rateLimits = new Map();
    }

    const record = socket.data.rateLimits.get(eventName);

    if (!record || now - record.start >= windowMs) {
        socket.data.rateLimits.set(eventName, {
            start: now,
            count: 1
        });

        return true;
    }

    if (record.count >= limit) {
        return false;
    }

    record.count++;

    return true;
}

// =========================
// Room Authorization
// =========================

function getJoinedRoom(socket, roomId) {
    if (!validRoomId(roomId)) {
        return null;
    }

    if (socket.data.roomId !== roomId) {
        return null;
    }

    return roomId;
}

// =========================
// Socket.IO
// =========================

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // =========================
    // Join Room
    // =========================

    socket.on("join-room", (roomId) => {
        if (!allowSocketEvent(socket, "join-room", 10, 60 * 1000)) {
            return;
        }

        if (!validRoomId(roomId)) {
            socket.emit("server-error", "Invalid room ID");
            return;
        }

        // Leave previous room
        if (socket.data.roomId) {
            socket.leave(socket.data.roomId);
        }

        const room = io.sockets.adapter.rooms.get(roomId);

        if (room && room.size >= MAX_ROOM_USERS) {
            socket.emit("server-error", "Room is full");
            return;
        }

        socket.join(roomId);
        socket.data.roomId = roomId;

        const state = getRoom(roomId);

        socket.emit("room-state", {
            video: state.video,
            playing: state.playing,
            time: state.time
        });

        socket.to(roomId).emit("user-joined", {
            id: socket.id
        });

        console.log(`${socket.id} joined room ${roomId}`);
    });

    // =========================
    // Load Video
    // =========================

    socket.on("video-load", (data) => {
        if (!allowSocketEvent(socket, "video-load", 10, 60 * 1000)) {
            return;
        }

        if (!data || typeof data !== "object") {
            return;
        }

        const roomId = getJoinedRoom(socket, data.roomId);

        if (!roomId) {
            return;
        }

        const videoId = String(data.videoId || "");

        if (!validVideoId(videoId)) {
            socket.emit("server-error", "Invalid YouTube video ID");
            return;
        }

        const room = getRoom(roomId);

        room.video = videoId;
        room.playing = false;
        room.time = 0;
        room.updatedAt = Date.now();

        io.to(roomId).emit("video-load", {
            videoId,
            time: 0,
            playing: false
        });
    });

    // =========================
    // Play
    // =========================

    socket.on("video-play", (data) => {
        if (!allowSocketEvent(socket, "video-play", 30, 10 * 1000)) {
            return;
        }

        if (!data || typeof data !== "object") {
            return;
        }

        const roomId = getJoinedRoom(socket, data.roomId);

        if (!roomId || !validTime(data.time)) {
            return;
        }

        const room = getRoom(roomId);
        const time = Number(data.time);

        room.playing = true;
        room.time = time;
        room.updatedAt = Date.now();

        socket.to(roomId).emit("video-play", {
            time
        });
    });

    // =========================
    // Pause
    // =========================

    socket.on("video-pause", (data) => {
        if (!allowSocketEvent(socket, "video-pause", 30, 10 * 1000)) {
            return;
        }

        if (!data || typeof data !== "object") {
            return;
        }

        const roomId = getJoinedRoom(socket, data.roomId);

        if (!roomId || !validTime(data.time)) {
            return;
        }

        const room = getRoom(roomId);
        const time = Number(data.time);

        room.playing = false;
        room.time = time;
        room.updatedAt = Date.now();

        socket.to(roomId).emit("video-pause", {
            time
        });
    });

    // =========================
    // Seek
    // =========================

    socket.on("video-seek", (data) => {
        if (!allowSocketEvent(socket, "video-seek", 60, 10 * 1000)) {
            return;
        }

        if (!data || typeof data !== "object") {
            return;
        }

        const roomId = getJoinedRoom(socket, data.roomId);

        if (!roomId || !validTime(data.time)) {
            return;
        }

        const room = getRoom(roomId);
        const time = Number(data.time);

        room.time = time;
        room.updatedAt = Date.now();

        socket.to(roomId).emit("video-seek", {
            time
        });
    });

    // =========================
    // Chat
    // =========================

    socket.on("chat-message", (data) => {
        if (!allowSocketEvent(socket, "chat-message", 20, 10 * 1000)) {
            socket.emit("server-error", "Too many messages");
            return;
        }

        if (!data || typeof data !== "object") {
            return;
        }

        const roomId = getJoinedRoom(socket, data.roomId);

        if (!roomId) {
            return;
        }

        const message = cleanMessage(data.message);

        if (!message) {
            return;
        }

        const username = cleanUsername(data.username);

        io.to(roomId).emit("chat-message", {
            username,
            message,
            time: Date.now()
        });
    });

    // =========================
    // Disconnect
    // =========================

    socket.on("disconnect", () => {
        const roomId = socket.data.roomId;

        console.log("User disconnected:", socket.id);

        if (roomId) {
            setTimeout(() => {
                const room = io.sockets.adapter.rooms.get(roomId);

                if (!room || room.size === 0) {
                    rooms.delete(roomId);
                    console.log(`Deleted empty room: ${roomId}`);
                }
            }, 100);
        }
    });
});

// =========================
// Main Page
// =========================

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

// =========================
// 404
// =========================

app.use((req, res) => {
    res.status(404).json({
        error: "Not Found"
    });
});

// =========================
// Start Server
// =========================

server.listen(PORT, () => {
    console.log(
        `WatchTogether running on http://localhost:${PORT}`
    );
});