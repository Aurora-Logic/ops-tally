// Import modules
import express, { Express, Request, Response } from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { json, urlencoded } from "express";
import dealerRoutes from "./routes/dealerRoutes";
import productRoutes from "./routes/UpdatedProductRoutes";
import brandRoutes from "./routes/brandRoutes";
import categoryRoutes from "./routes/categoryRoutes";
import subcategoryRoutes from "./routes/subcategoryRoutes";
import cartRoutes from "./routes/UpdatedCartRoutes";
import excelUploadRoutes from "./routes/excelUploadRoutes";
import scheduleRoutes from "./routes/UpdatedScheduleRoutes";
import orderHistoryRoutes from "./routes/UpdatedOrderHistoryRoutes";
import salesRoutes from "./routes/salesRoutes";
import authRoutes from "./routes/authRoutes";
import orderCounterRoutes from "./routes/orderCounterRoutes";
import dealerDashboardRoutes from "./routes/dealerDashboardRoutes";
import userRoutes from "./routes/userRoutes"; 
import pickerRoutes from "./routes/pickerRoutes";
// import UpdatedOrderHistory from "models/UpdatedOrderHistory";
// import notificationRoutes from "./routes/notificationRoutes";
import SalesDealerAllocation from "./routes/salesDealerAllocationRoutes";
import OrderMessage from "./routes/orderMessageRoutes";
import activityLogRoutes from "./routes/activityLogRoutes"
import dealerAndSalesExcelRoutes from "./routes/dealerAndSalesExcelRoutes";
import fs from "fs";
import cookieParser from "cookie-parser";
// Add a basic error logger middleware if not defined elsewhere
const errorLoggerMiddleware = (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  next(err);
};
import https from "https";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import Notification from "./models/Notification";
import imageRoutes from "./routes/imageRoutes";
import path from "path";
import * as client from 'prom-client';
import responseTime from "response-time";
import { ensureTypesenseCollection } from './config/typesense';

// Import auto backup system
import "./middleware/autoBackup";
import UpdatedOrderHistoryRoutes from "./routes/UpdatedOrderHistoryRoutes";
import tallyAdminRoutes from "./routes/tallyAdmin";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const { init: initTallyBridge } = _require('./tally/bridge');
const { resumeOnStartup: tallyResumeOnStartup } = _require('./tally/queue');
const { startCustomerSyncJob } = _require('./tally/jobs/customerSyncJob');
const { startStockSyncJob } = _require('./tally/jobs/stockSyncJob');

const collectDefaultMetrics = client.collectDefaultMetrics;
const Registry = client.Registry;
const register = new Registry();
collectDefaultMetrics({ register: register });

// Load environment variables
dotenv.config();

// Prevent MongoDB/Atlas reconnection errors from crashing the server in dev
process.on('unhandledRejection', (reason: any) => {
  if (reason?.name === 'MongooseServerSelectionError' || reason?.name === 'MongoNetworkError') {
    console.error('MongoDB connection error (suppressed in dev):', reason.message);
    return;
  }
  console.error('Unhandled rejection:', reason);
});

// Allow self-signed/unverified TLS certs in dev (sandbox env missing CA store)
if (process.env.VITE_PUBLIC_NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// MongoDB Connection Pooling Configuration
const POOL_SIZE = 10;  // Maximum number of connections in the pool
const MIN_POOL_SIZE = 2; // Minimum number of connections to keep open
const CONNECTION_TIMEOUT_MS = 30000; // Connection timeout in milliseconds
const SOCKET_TIMEOUT_MS = 45000; // Socket timeout in milliseconds

// Mongoose connection options with pooling
const mongooseOptions = {
  // Connection pool settings
  maxPoolSize: POOL_SIZE,         // Maximum number of connections in the pool
  minPoolSize: MIN_POOL_SIZE,     // Minimum number of connections in the pool
  socketTimeoutMS: SOCKET_TIMEOUT_MS, // How long a socket can be idle before timing out
  connectTimeoutMS: CONNECTION_TIMEOUT_MS, // How long to wait for a connection before timing out
  serverSelectionTimeoutMS: 30000, // How long to wait for server selection
  heartbeatFrequencyMS: 10000,    // How often to send heartbeats
    
  // Performance optimizations
  compressors: 'zlib',           // Enable compression for better performance
  maxConnecting: 2,              // Maximum number of connections in the connecting state
};

// Establish MongoDB connection with pooling
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('connected', () => {
  console.log('✅ MongoDB connected successfully with connection pooling');
  
  // Log pool statistics 
  if (mongoose.connection.db) {
    const stats = mongoose.connection.db.admin().serverStatus();
    stats.then(info => {
      console.log(`🔄 MongoDB connection pool stats: ${
        info.connections ? 
        `active: ${info.connections.active}, available: ${info.connections.available}, total: ${info.connections.current}` :
        'Not available'
      }`);
    }).catch(err => {
      console.warn('Could not retrieve server status:', err.message);
    });
  }
});

mongoose.connection.on('disconnected', () => {
  console.log('🔌 MongoDB disconnected');
});

// Connect to MongoDB with pooling - this is the MAIN connection for the entire app
mongoose.connect(process.env.MONGO_URI as string, mongooseOptions)
  .then(() => console.log('✅ MongoDB connection pool initialized'))
  .catch(err => {
    console.error('❌ MongoDB connection error (non-fatal in dev):', err.message);
  });

// Export the mongoose connection for use in other modules
export const dbConnection = mongoose.connection;

// Initialize express app
const app = express();

// Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(json());
app.use(cookieParser());
app.use(urlencoded({ extended: true }));

// Serve static files from the assets directory
app.use('/assets', express.static(path.join(process.cwd(), 'backend', 'assets')));

// MongoDB connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI!);
    console.log("✅ MongoDB connected successfully");
    
    // Initialize Typesense after successful DB connection
    console.log("🔍 Initializing Typesense...");
    try {
      await ensureTypesenseCollection();
      console.log("✅ Typesense collection initialized successfully");
    } catch (typesenseError) {
      console.error("❌ Typesense initialization failed:", typesenseError);
      console.log("⚠️  Product search will fall back to MongoDB queries");
    }
  } catch (err) {
    console.error("❌ MongoDB connection error", err);
    process.exit(1);
  }
};
connectDB();

// SSE Clients
const sseClients: { [key: string]: express.Response } = {};

app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.end(await register.metrics());
});

const reqResTime = new client.Histogram({
  name: "http_express_req_res_time",
  help: "Shows Request and Response time taken by Server and API.",
  labelNames: ["method", "route", "status_code"],
  buckets: [1, 50, 100, 200, 400, 500, 800, 1000, 2000],
  registers: [register], // Register with the custom registry
});

app.use(responseTime((req, res, time) => {
  reqResTime.labels({
    method: req.method,
    route: req.url ? req.url : "",
    status_code: res.statusCode.toString()
  }).observe(time);
}));

// SSE endpoint
app.get("/api/progress", (req, res) => {
  const clientId = req.query.clientId as string;
  if (!clientId) {
    res.status(400).json({ message: "clientId is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients[clientId] = res;

  req.on("close", () => {
    delete sseClients[clientId];
  });
});

// Progress update function
export const sendProgressUpdate = (
  clientId: string,
  data: { processed: number; total: number; message?: string }
) => {
  if (sseClients[clientId]) {
    sseClients[clientId].write(`data: ${JSON.stringify(data)}\n\n`);
  }
};

// Connection status endpoint - shows MongoDB connection status
app.get("/api/db-status", (req, res) => {
  const connectionState = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const status = {
    connected: mongoose.connection.readyState === 1,
    state: connectionState[mongoose.connection.readyState],
    poolSize: POOL_SIZE,
    minPoolSize: MIN_POOL_SIZE,
    host: mongoose.connection.host || 'unknown',
    db: mongoose.connection.name || 'unknown'
  };
  
  res.status(200).json({ 
    status: 'ok', 
    message: `Database ${status.state}`, 
    dbStatus: status 
  });
});

// Routes
app.use("/api/dealers", dealerRoutes);
app.use("/api/products", productRoutes);
app.use("/api/brands", brandRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/subcategories", subcategoryRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/excel", excelUploadRoutes); // Mount Excel upload routes under /api/excel
app.use("/api/schedule", scheduleRoutes);
app.use("/api/order", orderHistoryRoutes);
app.use("/api", imageRoutes); // Mount image routes under /api
app.use("/api/excel", dealerAndSalesExcelRoutes); // Mount Excel processing routes under /api/excel
app.use("/api", authRoutes);
app.use("/api", salesRoutes);
app.use("/api", UpdatedOrderHistoryRoutes);
app.use("/api", orderCounterRoutes);
app.use("/api", dealerDashboardRoutes);
app.use("/api", userRoutes); // Mount the user routes under /api
// app.use("/api", notificationRoutes); // Mount notification routes under /api/notifications
app.use("/api", SalesDealerAllocation);
app.use("/api/orders", OrderMessage)
app.use("/api/activity-logs", activityLogRoutes); // Mount activity log routes under /api/activity-logs
app.use("/api/picker", pickerRoutes);
app.use("/api/tally", tallyAdminRoutes);
// Base test route
app.get("/", (req, res) => {
  res.send("Secure server is running!");
});

// Health check endpoint
app.get("/api/health", async (req, res) => {
  try {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      port: PORT,
      database: 'disconnected'
    };

    // Check database connection
    if (mongoose.connection.readyState === 1) {
      health.database = 'connected';
    } else if (mongoose.connection.readyState === 2) {
      health.database = 'connecting';
    } else if (mongoose.connection.readyState === 3) {
      health.database = 'disconnecting';
    }

    const statusCode = health.database === 'connected' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Activity logging error handler (should be before other error handlers)
app.use(errorLoggerMiddleware);

// Create HTTP server
const server = http.createServer(app);

// Tally: resume pending jobs and start customer cron (server-independent)
tallyResumeOnStartup();
startCustomerSyncJob();
startStockSyncJob();

// --- Socket.IO Optimization ---
// Per-socket rate limiting (simple in-memory, for production use Redis or similar)
const RATE_LIMIT_WINDOW_MS = 5000; // 5 seconds
const MAX_EVENTS_PER_WINDOW = 20;  // Max 20 events per 5 seconds per socket
const socketEventTimestamps: Record<string, number[]> = {};

function isRateLimited(socketId: string) {
  const now = Date.now();
  if (!socketEventTimestamps[socketId]) {
    socketEventTimestamps[socketId] = [];
  }
  // Remove old timestamps
  socketEventTimestamps[socketId] = socketEventTimestamps[socketId].filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  if (socketEventTimestamps[socketId].length >= MAX_EVENTS_PER_WINDOW) {
    return true;
  }
  socketEventTimestamps[socketId].push(now);
  return false;
}

// Initialize Socket.IO with compression and tuned intervals
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000, // 60s
  pingInterval: 25000, // 25s
  perMessageDeflate: {
    threshold: 1024, // Only compress messages >1KB
    zlibDeflateOptions: { level: 3 }, // Compression level
    zlibInflateOptions: { chunkSize: 16 * 1024 }
  }
});

// Socket.IO connection handler
// io.on("connection", (socket) => {
//   console.log(`Client connected: ${socket.id}`);

//   // --- Clean up listeners on disconnect ---
//   const cleanup = () => {
//     delete socketEventTimestamps[socket.id];
//     // Remove all listeners for this socket
//     socket.removeAllListeners();
//     console.log(`Cleaned up socket: ${socket.id}`);
//   };
//   socket.on("disconnect", cleanup);

//   // --- Rate limit all custom events ---
//   const rateLimitWrapper = (eventName: string, handler: (...args: any[]) => void) => {
//     socket.on(eventName, (...args) => {
//       if (isRateLimited(socket.id)) {
//         socket.emit("rate_limit", { message: `Too many ${eventName} events. Please slow down.` });
//         return;
//       }
//       handler(...args);
//     });
//   };

//   // --- Room management ---
//   rateLimitWrapper("join_admin_room", () => {
//     socket.join("admin_room");
//     console.log(`${socket.id} joined admin room`);
//   });
//   rateLimitWrapper("leave_admin_room", () => {
//     socket.leave("admin_room");
//     console.log(`${socket.id} left admin room`);
//   });
//   rateLimitWrapper("join_user_room", (userId) => {
//     if (userId) {
//       socket.join(userId.toString());
//       console.log(`${socket.id} joined user room: ${userId}`);
//       // Send the current unread count when joining
//       Notification.countDocuments({ userId, isRead: false })
//         .then((count: number) => {
//           socket.emit("unread_notification_count", { count });
//           console.log(`Sent unread count ${count} to user ${userId}`);
//         })
//         .catch((err: Error) => {
//           console.error(`Error getting unread count for user ${userId}:`, err);
//         });
//       // Verify room membership
//       const rooms = Array.from(socket.rooms);
//       console.log(`Socket ${socket.id} current rooms: ${rooms.join(', ')}`);
//     }
//   });
//   rateLimitWrapper("leave_user_room", (userId) => {
//     if (userId) {
//       socket.leave(userId.toString());
//       console.log(`${socket.id} left user room: ${userId}`);
//     }
//   });

//   // --- Ping/pong ---
//   rateLimitWrapper("ping", () => {
//     console.log(`Received ping from ${socket.id}`);
//     socket.emit("pong");
//   });

//   // --- Notification event (rate limited) ---
//   rateLimitWrapper("send_status_notification", async (data) => {
//     try {
//       console.log(`📣 Received status notification request:`, JSON.stringify(data));
      
//       // Extract data
//       const { dealerId, salesmanId, orderCode, previousStatus, newStatus, productName, dealerName, productCount } = data;
      
//       // Create notification message
//       // const message = `Your order ${orderCode} status has been updated from ${previousStatus} to ${newStatus}`;
//       // const detailMessage = `Order ${orderCode} containing ${productCount} ${productCount > 1 ? 'items' : 'item'} (${productName}) has been moved to ${newStatus}`;
      
//       // Store notification for dealer
//       if (dealerId) {
//         try {
//           const dealerNotification = new Notification({
//             userId: dealerId,
//             userType: 'dealer',
//             title: `Order Status Update: ${orderCode}`,
//             // message: message,
//             // detailMessage: detailMessage,
//             type: 'orderStatus',
//             isRead: false,
//             relatedId: orderCode,
//             createdAt: new Date(),
//           });
          
//           await dealerNotification.save();
//           console.log(`✅ Dealer notification saved for ${dealerId}`);
          
//           // Send notification to dealer's room
//           io.to(dealerId.toString()).emit("new_notification", {
//             notification: dealerNotification,
//             // message: message
//           });
          
//           // Send confirmation to admin
//           socket.emit("notification_delivered", { 
//             orderCode, 
//             recipient: `dealer ${dealerName}`,
//             status: 'success'
//           });
          
//           console.log(`📨 Notification sent to dealer ${dealerId} for order ${orderCode}`);
//         } catch (error) {
//           console.error(`❌ Error saving dealer notification:`, error);
//         }
//       }
      
//       // Store notification for salesman
//       if (salesmanId) {
//         try {
//           const salesNotification = new Notification({
//             userId: salesmanId,
//             userType: 'salesman',
//             title: `Order Status Update: ${orderCode}`,
//             // message: message,
//             // detailMessage: detailMessage,
//             type: 'orderStatus',
//             isRead: false,
//             relatedId: orderCode,
//             createdAt: new Date(),
//           });
          
//           await salesNotification.save();
//           console.log(`✅ Salesman notification saved for ${salesmanId}`);
          
//           // Send notification to salesman's room
//           io.to(salesmanId.toString()).emit("new_notification", {
//             notification: salesNotification,
//             // message: message
//           });
          
//           // Send confirmation to admin
//           socket.emit("notification_delivered", { 
//             orderCode, 
//             recipient: `salesman ID: ${salesmanId}`,
//             status: 'success'
//           });
          
//           console.log(`📨 Notification sent to salesman ${salesmanId} for order ${orderCode}`);
//         } catch (error) {
//           console.error(`❌ Error saving salesman notification:`, error);
//         }
//       }
//     } catch (error) {
//       console.error('❌ Error processing notification:', error);
//       socket.emit("notification_error", { error: "Failed to process notification" });
//     }
//   });

//   // --- Error event ---
//   socket.on("error", (error) => {
//     console.error(`Socket error for ${socket.id}:`, error);
//   });

//   // --- Further scaling: ---
//   // For multi-server deployments, use the Redis adapter:
//   // const { createAdapter } = require('@socket.io/redis-adapter');
//   // io.adapter(createAdapter(redisClient, pubClient));
// });

// Make io accessible to other parts of the application
export { io };

// Start the server with the HTTP server instead of the Express app
const PORT = process.env.PORT || 7000;

// Start the server based on environment
if (process.env.VITE_PUBLIC_NODE_ENV === 'production') {
  try {
    // In production, use HTTPS
    const httpsOptions = {
      key: fs.readFileSync("/home/ubuntu/gc_ops/certs/privkey.pem"),
      cert: fs.readFileSync("/home/ubuntu/gc_ops/certs/fullchain.pem"),
    };
    
    // Create HTTPS server with Socket.IO
    const httpsServer = https.createServer(httpsOptions, app);
    io.attach(httpsServer);
    initTallyBridge(httpsServer);

    httpsServer.listen(PORT, () => {
      console.log(`🔐 Secure server running at https://ops.auroralogic.in:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start HTTPS server:", err);
    console.log("Falling back to HTTP server");
    
    // Fallback to HTTP
    initTallyBridge(server);
    server.listen(PORT, () => {
      console.log(`Server running on HTTP port ${PORT}`);
    });
  }
} else if (process.env.VITE_PUBLIC_NODE_ENV === 'development') {
  try {
    // In production, use HTTPS
    // const httpsOptions = {
    //   key: fs.readFileSync("../certs/privkey.pem"),
    //   cert: fs.readFileSync("../certs/fullchain.pem"),
    // };
    const httpsOptions = {
      key: fs.readFileSync("./certificates/localhost-key.pem"),
      cert: fs.readFileSync("./certificates/localhost.pem"),
    };
    
    // Create HTTPS server with Socket.IO
    const httpsServer = https.createServer(httpsOptions, app);
    io.attach(httpsServer);
    
    initTallyBridge(httpsServer);

    httpsServer.listen(PORT, () => {
      console.log(`🔐 Secure server running at https://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start HTTPS server:", err);
    console.log("Falling back to HTTP server");
    
    // Fallback to HTTP
    initTallyBridge(server);
    server.listen(PORT, () => {
      console.log(`Server running on HTTP port ${PORT}`);
    });
  }
}else {
  // In development, try to use the same certificates that Next.js generated
  try {
    const httpsOptions = {
      key: fs.readFileSync("./certificates/localhost-key.pem"),
      cert: fs.readFileSync("./certificates/localhost.pem"),
    };
    
    // Create HTTPS server with Socket.IO
    const httpsServer = https.createServer(httpsOptions, app);
    io.attach(httpsServer);
    
    initTallyBridge(httpsServer);

    httpsServer.listen(PORT, () => {
      console.log(`🔐 Dev HTTPS server running at https://localhost:${PORT}`);
    });
  } catch (err: any) {
    console.log("HTTPS dev server not started, using HTTP instead:", err.message);
    // In development, use HTTP as fallback
    initTallyBridge(server);
    server.listen(PORT, () => {
      console.log(`🚀 Dev server running at http://localhost:${PORT}`);
    });
  }
}
