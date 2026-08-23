require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const errorMiddleware = require("./middlewares/error.middleware");
const indexRoutes = require("./routes/index.routes");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

app.set("io", io);

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static("public/uploads"));

// Mount all routes
app.use("/api", indexRoutes);

// Generic 404 Handler
app.use((req, res, next) => {
  const AppError = require("./utils/appError.util");
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Centralized error handling
app.use(errorMiddleware);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
