const express = require('express');
const mongoose = require('mongoose');
const mqtt = require('mqtt');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware - NO HELMET for development
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// MongoDB connection
const MONGODB_URI = 'mongodb+srv://greentech-user:CbgNnrKN41tiW38y@greentech-cluster.mldxnyb.mongodb.net/greentech?retryWrites=true&w=majority&appName=GreenTech-Cluster';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  deviceId: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  dashboard: {
    relays: [{
      index: Number,
      name: String,
      image: String,
      schedules: [{
        days: [Number],
        startTime: String,
        endTime: String,
        enabled: { type: Boolean, default: true }
      }],
      enabled: { type: Boolean, default: true },
      createdAt: { type: Date, default: Date.now }
    }]
  }
});

const deviceStatusSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  ip: String,
  rssi: Number,
  uptime: Number,
  relays: [{
    index: Number,
    state: Boolean,
    name: String,
    timer: Number
  }],
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const DeviceStatus = mongoose.model('DeviceStatus', deviceStatusSchema);

// MQTT Client
const mqttClient = mqtt.connect('mqtt://localhost');

const connectedDevices = new Map();
const wsClients = new Set();

// WebSocket connection
wss.on('connection', (ws, req) => {
  wsClients.add(ws);
  console.log('🔌 WebSocket client connected');

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log('🔌 WebSocket client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    wsClients.delete(ws);
  });
});

function broadcastToWebSockets(data) {
  const message = JSON.stringify(data);
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// MQTT Handlers
mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
  mqttClient.subscribe('green-tech/credentials');
  mqttClient.subscribe('green-tech/relay-status');
  mqttClient.subscribe('green-tech/device-status');
});

mqttClient.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    console.log(`📨 MQTT Message received on ${topic}:`, data);

    if (topic === 'green-tech/credentials') {
      await handleUserRegistration(data);
    } else if (topic === 'green-tech/relay-status') {
      await handleRelayStatus(data);
    } else if (topic === 'green-tech/device-status') {
      await handleDeviceStatus(data);
    }
  } catch (error) {
    console.error('❌ Error processing MQTT message:', error);
  }
});

async function handleUserRegistration(data) {
  try {
    console.log('👤 Processing user registration:', data);

    // Validate required fields
    if (!data.username || !data.password || !data.deviceId) {
      console.error('❌ Missing required fields in registration data');
      return;
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { username: data.username },
        { deviceId: data.deviceId }
      ]
    });

    if (existingUser) {
      console.log('⚠️ User already exists:', existingUser.username);
      // Update existing user's password
      const hashedPassword = await bcrypt.hash(data.password, 12);
      existingUser.password = hashedPassword;
      await existingUser.save();
      console.log('✅ Updated password for existing user:', data.username);
      return;
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);

    const user = new User({
      username: data.username,
      password: hashedPassword,
      deviceId: data.deviceId,
      dashboard: { relays: [] }
    });

    await user.save();
    console.log(`✅ User ${data.username} registered with device ${data.deviceId}`);

  } catch (error) {
    console.error('❌ Error registering user:', error);
  }
}

async function handleRelayStatus(data) {
  try {
    broadcastToWebSockets({
      type: 'relay_status',
      data: data
    });

    // Update latest device status
    await DeviceStatus.findOneAndUpdate(
      { deviceId: data.deviceId },
      {
        $set: {
          [`relays.${data.relay}.state`]: data.state,
          [`relays.${data.relay}.timer`]: data.timer,
          timestamp: new Date()
        }
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('❌ Error handling relay status:', error);
  }
}

async function handleDeviceStatus(data) {
  try {
    const deviceStatus = new DeviceStatus(data);
    await deviceStatus.save();

    connectedDevices.set(data.deviceId, {
      ...data,
      lastSeen: new Date()
    });

    broadcastToWebSockets({
      type: 'device_status',
      data: data
    });
  } catch (error) {
    console.error('❌ Error handling device status:', error);
  }
}

// Relay Control Functions
function controlRelay(deviceId, relayIndex, action, duration = null) {
  const message = {
    deviceId: deviceId,
    relay: relayIndex,
    action: action
  };

  if (duration !== null) {
    message.duration = duration;
  }

  mqttClient.publish('green-tech/relay-control', JSON.stringify(message));
}

// ==================== AUTHENTICATION & USER ROUTES ====================

// Enhanced Login Route with Comprehensive Debugging
app.post('/api/login', async (req, res) => {
  try {
    console.log('🔐 Login attempt received');
    console.log('Request body:', req.body);

    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      console.log('❌ Missing username or password');
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    console.log(`🔍 Searching for user: "${username}"`);

    // Find user (case-insensitive search)
    const user = await User.findOne({
      username: { $regex: new RegExp(`^${username}$`, 'i') }
    });

    if (!user) {
      console.log(`❌ User not found: "${username}"`);

      // List all available users for debugging
      const allUsers = await User.find({}, 'username deviceId');
      console.log('📋 Available users:', allUsers.map(u => u.username));

      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    console.log(`✅ User found: ${user.username}`);
    console.log(`📋 Stored hash: ${user.password.substring(0, 20)}...`);
    console.log(`🔑 Device ID: ${user.deviceId}`);

    // Compare passwords
    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log(`🔑 Password validation result: ${isPasswordValid}`);

    if (!isPasswordValid) {
      console.log(`❌ Invalid password for user: ${user.username}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    console.log(`✅ Login successful for user: ${user.username}`);

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        username: user.username,
        deviceId: user.deviceId,
        dashboard: user.dashboard
      }
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// User Registration API (for manual testing)
app.post('/api/register', async (req, res) => {
  try {
    console.log('👤 Manual registration attempt:', req.body);

    const { username, password, deviceId } = req.body;

    if (!username || !password || !deviceId) {
      return res.status(400).json({
        success: false,
        message: 'Username, password, and deviceId are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { username: username },
        { deviceId: deviceId }
      ]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User or device already exists'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = new User({
      username: username,
      password: hashedPassword,
      deviceId: deviceId,
      dashboard: { relays: [] }
    });

    await user.save();

    console.log(`✅ Manual registration successful: ${username}`);

    res.json({
      success: true,
      message: 'User registered successfully',
      user: {
        username: user.username,
        deviceId: user.deviceId
      }
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed: ' + error.message
    });
  }
});

// ==================== DASHBOARD & RELAY ROUTES ====================

// Dashboard Data
app.get('/api/dashboard/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;

    const user = await User.findOne({ deviceId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const deviceStatus = await DeviceStatus.findOne({ deviceId })
      .sort({ timestamp: -1 });

    res.json({
      success: true,
      dashboard: user.dashboard,
      deviceStatus: deviceStatus
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Relay Control
app.post('/api/relay/:deviceId/:relayIndex', async (req, res) => {
  try {
    const { deviceId, relayIndex } = req.params;
    const { action, duration } = req.body;

    controlRelay(deviceId, parseInt(relayIndex), action, duration);

    res.json({
      success: true,
      message: `Relay ${relayIndex} ${action} command sent`
    });
  } catch (error) {
    console.error('Error controlling relay:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update Relay Configuration
app.put('/api/dashboard/relay/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { index, name, image, enabled } = req.body;

    const user = await User.findOne({ deviceId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    let relay = user.dashboard.relays.find(r => r.index === index);

    if (relay) {
      relay.name = name;
      relay.image = image;
      relay.enabled = enabled;
    } else {
      user.dashboard.relays.push({
        index,
        name,
        image,
        enabled: enabled !== undefined ? enabled : true,
        schedules: []
      });
    }

    await user.save();

    res.json({
      success: true,
      message: 'Relay configuration updated',
      dashboard: user.dashboard
    });
  } catch (error) {
    console.error('Error updating relay:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Add Schedule
app.post('/api/dashboard/schedule/:deviceId/:relayIndex', async (req, res) => {
  try {
    const { deviceId, relayIndex } = req.params;
    const { days, startTime, endTime, enabled } = req.body;

    const user = await User.findOne({ deviceId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const relay = user.dashboard.relays.find(r => r.index === parseInt(relayIndex));
    if (!relay) {
      return res.status(404).json({ success: false, message: 'Relay not found' });
    }

    relay.schedules.push({
      days,
      startTime,
      endTime,
      enabled: enabled !== undefined ? enabled : true
    });

    await user.save();

    res.json({
      success: true,
      message: 'Schedule added successfully',
      schedules: relay.schedules
    });
  } catch (error) {
    console.error('Error adding schedule:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete Schedule
app.delete('/api/dashboard/schedule/:deviceId/:relayIndex/:scheduleIndex', async (req, res) => {
  try {
    const { deviceId, relayIndex, scheduleIndex } = req.params;

    const user = await User.findOne({ deviceId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const relay = user.dashboard.relays.find(r => r.index === parseInt(relayIndex));
    if (!relay) {
      return res.status(404).json({ success: false, message: 'Relay not found' });
    }

    relay.schedules.splice(parseInt(scheduleIndex), 1);
    await user.save();

    res.json({
      success: true,
      message: 'Schedule deleted successfully',
      schedules: relay.schedules
    });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ==================== DEBUG & ADMIN ROUTES ====================

// Debug route to check user data
app.get('/api/debug/user/:username', async (req, res) => {
  try {
    const { username } = req.params;
    console.log(`🔍 Debug: Searching for user: "${username}"`);

    const user = await User.findOne({
      username: { $regex: new RegExp(`^${username}$`, 'i') }
    });

    if (!user) {
      const allUsers = await User.find({}, 'username deviceId createdAt');
      return res.json({
        success: false,
        message: 'User not found',
        allUsers: allUsers
      });
    }

    res.json({
      success: true,
      user: {
        username: user.username,
        deviceId: user.deviceId,
        createdAt: user.createdAt,
        hasPassword: !!user.password,
        passwordLength: user.password ? user.password.length : 0,
        relayCount: user.dashboard.relays.length,
        scheduleCount: user.dashboard.relays.reduce((sum, relay) => sum + relay.schedules.length, 0)
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// List all users
app.get('/api/debug/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username deviceId createdAt');
    res.json({
      success: true,
      users: users
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Test user creation
app.post('/api/debug/create-test-user', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password required'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const deviceId = 'TEST-' + Date.now();

    const user = new User({
      username: username,
      password: hashedPassword,
      deviceId: deviceId,
      dashboard: { relays: [] }
    });

    await user.save();

    res.json({
      success: true,
      message: 'Test user created successfully',
      user: {
        username: user.username,
        deviceId: user.deviceId,
        password: password // Return plain text for testing
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== DATABASE VIEWER ROUTES ====================

// Database Viewer Route
app.get('/admin/database', async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 });
    const deviceStatus = await DeviceStatus.find({}).sort({ timestamp: -1 }).limit(50);

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Database Viewer - GreenTech</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 20px; background: #f5f5f5; color: #333; }
              .container { max-width: 1200px; margin: 0 auto; }
              .header { background: linear-gradient(135deg, #2d5016 0%, #4a7c2a 100%); color: white; padding: 30px; border-radius: 15px; margin-bottom: 20px; text-align: center; }
              .section { background: white; padding: 25px; margin-bottom: 25px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
              table { width: 100%; border-collapse: collapse; margin-top: 15px; }
              th, td { padding: 14px; text-align: left; border-bottom: 1px solid #e1e5e9; }
              th { background: #2d5016; color: white; font-weight: 600; }
              tr:hover { background: #f8f9fa; }
              .badge { padding: 6px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 600; }
              .badge-success { background: #d4edda; color: #155724; }
              .badge-danger { background: #f8d7da; color: #721c24; }
              .badge-warning { background: #fff3cd; color: #856404; }
              .stats { display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
              .stat-card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); flex: 1; min-width: 200px; text-align: center; }
              .stat-value { font-size: 2em; font-weight: bold; color: #2d5016; margin: 10px 0; }
              .actions { display: flex; gap: 10px; margin-top: 20px; }
              .btn { padding: 12px 20px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s ease; }
              .btn-primary { background: #4CAF50; color: white; }
              .btn-danger { background: #dc3545; color: white; }
              .btn-secondary { background: #6c757d; color: white; }
              .btn:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.2); }
              code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
              .debug-section { background: #e9ecef; padding: 15px; border-radius: 8px; margin: 10px 0; }
              @media (max-width: 768px) {
                  .container { margin: 10px; }
                  table { font-size: 0.9em; }
                  th, td { padding: 8px; }
              }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>🌱 GreenTech Database Viewer</h1>
                  <p>Real-time monitoring of your agricultural control system</p>
              </div>

              <div class="stats">
                  <div class="stat-card">
                      <div>Total Users</div>
                      <div class="stat-value">${users.length}</div>
                  </div>
                  <div class="stat-card">
                      <div>Device Records</div>
                      <div class="stat-value">${deviceStatus.length}</div>
                  </div>
                  <div class="stat-card">
                      <div>Active Devices</div>
                      <div class="stat-value">${new Set(deviceStatus.map(s => s.deviceId)).size}</div>
                  </div>
              </div>

              <div class="debug-section">
                  <h3>🔧 Debug Tools</h3>
                  <div class="actions">
                      <button class="btn btn-secondary" onclick="testLogin()">Test Login</button>
                      <button class="btn btn-secondary" onclick="listUsers()">List Users</button>
                      <button class="btn btn-secondary" onclick="createTestUser()">Create Test User</button>
                  </div>
                  <div id="debugResult" style="margin-top: 10px; padding: 10px; background: white; border-radius: 5px; display: none;"></div>
              </div>

              <div class="section">
                  <h2>👥 Registered Users (${users.length})</h2>
                  <table>
                      <thead>
                          <tr>
                              <th>Username</th>
                              <th>Device ID</th>
                              <th>Created At</th>
                              <th>Relays Configured</th>
                              <th>Schedules</th>
                          </tr>
                      </thead>
                      <tbody>
                          ${users.map(user => {
                              const totalSchedules = user.dashboard.relays.reduce((sum, relay) => sum + relay.schedules.length, 0);
                              return `
                              <tr>
                                  <td><strong>${user.username}</strong></td>
                                  <td><code>${user.deviceId}</code></td>
                                  <td>${new Date(user.createdAt).toLocaleString()}</td>
                                  <td>
                                      <span class="badge ${user.dashboard.relays.length > 0 ? 'badge-success' : 'badge-warning'}">
                                          ${user.dashboard.relays.length} relays
                                      </span>
                                  </td>
                                  <td>
                                      <span class="badge ${totalSchedules > 0 ? 'badge-success' : 'badge-warning'}">
                                          ${totalSchedules} schedules
                                      </span>
                                  </td>
                              </tr>
                              `;
                          }).join('')}
                      </tbody>
                  </table>
              </div>

              <div class="section">
                  <h2>📊 Recent Device Status (${deviceStatus.length})</h2>
                  <table>
                      <thead>
                          <tr>
                              <th>Device ID</th>
                              <th>IP Address</th>
                              <th>Signal Strength</th>
                              <th>Online Relays</th>
                              <th>Uptime</th>
                              <th>Last Update</th>
                          </tr>
                      </thead>
                      <tbody>
                          ${deviceStatus.map(status => {
                              const onlineRelays = status.relays ? status.relays.filter(r => r.state).length : 0;
                              const totalRelays = status.relays ? status.relays.length : 0;
                              const uptimeMinutes = status.uptime ? Math.floor(status.uptime / 60000) : 0;
                              return `
                              <tr>
                                  <td><code>${status.deviceId}</code></td>
                                  <td>${status.ip || 'N/A'}</td>
                                  <td>${status.rssi ? `${status.rssi} dBm` : 'N/A'}</td>
                                  <td>
                                      <span class="badge ${onlineRelays > 0 ? 'badge-success' : 'badge-danger'}">
                                          ${onlineRelays} / ${totalRelays}
                                      </span>
                                  </td>
                                  <td>${uptimeMinutes} min</td>
                                  <td>${new Date(status.timestamp).toLocaleString()}</td>
                              </tr>
                              `;
                          }).join('')}
                      </tbody>
                  </table>
              </div>

              <div class="section">
                  <h2>⚙️ Database Actions</h2>
                  <div class="actions">
                      <button class="btn btn-primary" onclick="location.reload()">🔄 Refresh Data</button>
                      <button class="btn btn-danger" onclick="clearOldData()">🗑️ Clear Old Data (1h+)</button>
                      <button class="btn btn-primary" onclick="window.open('/admin', '_blank')">📊 Open Admin Dashboard</button>
                  </div>
                  <div id="actionResult" style="margin-top: 15px;"></div>
              </div>
          </div>

          <script>
              async function testLogin() {
                  const username = prompt('Enter username to test:');
                  const password = prompt('Enter password:');

                  if (!username || !password) return;

                  try {
                      const response = await fetch('/api/login', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ username, password })
                      });
                      const result = await response.json();
                      document.getElementById('debugResult').innerHTML = '<pre>' + JSON.stringify(result, null, 2) + '</pre>';
                      document.getElementById('debugResult').style.display = 'block';
                  } catch (error) {
                      document.getElementById('debugResult').innerHTML = 'Error: ' + error;
                      document.getElementById('debugResult').style.display = 'block';
                  }
              }

              async function listUsers() {
                  try {
                      const response = await fetch('/api/debug/users');
                      const result = await response.json();
                      document.getElementById('debugResult').innerHTML = '<pre>' + JSON.stringify(result, null, 2) + '</pre>';
                      document.getElementById('debugResult').style.display = 'block';
                  } catch (error) {
                      document.getElementById('debugResult').innerHTML = 'Error: ' + error;
                      document.getElementById('debugResult').style.display = 'block';
                  }
              }

              async function createTestUser() {
                  const username = prompt('Enter test username:');
                  const password = prompt('Enter test password:');

                  if (!username || !password) return;

                  try {
                      const response = await fetch('/api/debug/create-test-user', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ username, password })
                      });
                      const result = await response.json();
                      document.getElementById('debugResult').innerHTML = '<pre>' + JSON.stringify(result, null, 2) + '</pre>';
                      document.getElementById('debugResult').style.display = 'block';
                  } catch (error) {
                      document.getElementById('debugResult').innerHTML = 'Error: ' + error;
                      document.getElementById('debugResult').style.display = 'block';
                  }
              }

              async function clearOldData() {
                  const resultDiv = document.getElementById('actionResult');
                  try {
                      const response = await fetch('/admin/clear-old-data', { method: 'POST' });
                      const data = await response.json();
                      resultDiv.innerHTML = \`<div style="color: \${data.success ? 'green' : 'red'};">\${data.message}</div>\`;
                      if (data.success) {
                          setTimeout(() => location.reload(), 2000);
                      }
                  } catch (error) {
                      resultDiv.innerHTML = '<div style="color: red;">Error clearing data</div>';
                  }
              }
          </script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading database view: ' + error.message);
  }
});

// Admin Dashboard Route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Clear Old Data
app.post('/admin/clear-old-data', async (req, res) => {
  try {
    // Delete device status older than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const result = await DeviceStatus.deleteMany({ timestamp: { $lt: oneHourAgo } });

    res.json({
      success: true,
      message: `Cleared ${result.deletedCount} old device status records`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API routes for database queries
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username deviceId createdAt');
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/admin/device-status', async (req, res) => {
  try {
    const { limit = 50, deviceId } = req.query;
    let query = {};
    if (deviceId) query.deviceId = deviceId;

    const status = await DeviceStatus.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const userCount = await User.countDocuments();
    const statusCount = await DeviceStatus.countDocuments();
    const recentStatus = await DeviceStatus.findOne().sort({ timestamp: -1 });
    const activeDevices = await DeviceStatus.distinct('deviceId');

    res.json({
      success: true,
      stats: {
        totalUsers: userCount,
        totalDeviceStatus: statusCount,
        activeDevices: activeDevices.length,
        lastUpdate: recentStatus?.timestamp || 'Never'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== STATIC ROUTES ====================

// Serve login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve dashboard page
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'GreenTech Server is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// ==================== SCHEDULER ====================

// ==================== SCHEDULE MANAGEMENT ====================

// Enhanced schedule checking with better logging
function setupScheduler() {
    // Check schedules every minute
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            const currentDay = now.getDay(); // 0-6 (Sunday-Saturday)
            const currentTime = now.toLocaleTimeString('en-EG', {
  timeZone: 'Africa/Cairo',
  hour: '2-digit',
  minute: '2-digit'
});

            console.log(`⏰ Schedule Check - Time: ${currentTime}, Day: ${currentDay}`);

            const users = await User.find({});
            console.log(`🔍 Checking schedules for ${users.length} users`);

            let totalChecks = 0;
            let activatedSchedules = 0;

            for (const user of users) {
                console.log(`👤 Checking user: ${user.username}`);

                for (const relay of user.dashboard.relays) {
                    if (!relay.enabled) {
                        console.log(`   ⏭️  Relay ${relay.index} disabled, skipping`);
                        continue;
                    }

                    console.log(`   🔌 Checking relay: ${relay.name} (${relay.schedules.length} schedules)`);

                    for (const schedule of relay.schedules) {
                        totalChecks++;

                        if (!schedule.enabled) {
                            console.log(`      ⏭️  Schedule disabled, skipping`);
                            continue;
                        }

                        const isScheduledDay = schedule.days.includes(currentDay);
                        const isScheduledTime = currentTime >= schedule.startTime && currentTime <= schedule.endTime;

                        console.log(`      📅 Schedule: ${schedule.startTime}-${schedule.endTime}, Days: [${schedule.days}]`);
                        console.log(`      🔍 Match: Day=${isScheduledDay}, Time=${isScheduledTime}`);

                        if (isScheduledDay && isScheduledTime) {
                            // Turn on relay according to schedule
                            controlRelay(user.deviceId, relay.index, 'on');
                            activatedSchedules++;
                            console.log(`      ✅ ACTIVATED: Device ${user.deviceId}, Relay ${relay.index}`);
                        }
                    }
                }
            }

            console.log(`📊 Schedule Check Complete: ${totalChecks} checks, ${activatedSchedules} activations`);

        } catch (error) {
            console.error('❌ Scheduler error:', error);
        }
    });
}

// API to get schedule status
app.get('/api/schedules/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;

        const user = await User.findOne({ deviceId });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const schedules = user.dashboard.relays.flatMap(relay =>
            relay.schedules.map(schedule => ({
                relayIndex: relay.index,
                relayName: relay.name,
                ...schedule,
                nextRun: calculateNextRun(schedule)
            }))
        );

        res.json({
            success: true,
            schedules: schedules
        });

    } catch (error) {
        console.error('Error fetching schedules:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Calculate next run time for a schedule
function calculateNextRun(schedule) {
    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = now.toLocaleTimeString('en-EG', {
  timeZone: 'Africa/Cairo',
  hour: '2-digit',
  minute: '2-digit'
});

    // Find next matching day
    let daysToAdd = 0;
    for (let i = 1; i <= 7; i++) {
        const nextDay = (currentDay + i) % 7;
        if (schedule.days.includes(nextDay)) {
            daysToAdd = i;
            break;
        }
    }

    const nextDate = new Date(now);
    nextDate.setDate(now.getDate() + daysToAdd);

    return {
        date: nextDate.toISOString().split('T')[0],
        time: schedule.startTime,
        daysFromNow: daysToAdd
    };
}
// Initialize scheduler
setupScheduler();

// ==================== SERVER START ====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 GreenTech Relay Controller running on http://34.229.153.185:${PORT}`);
  console.log(`📊 Database Viewer: http://34.229.153.185:${PORT}/admin/database`);
  console.log(`🔍 Health Check: http://34.229.153.185:${PORT}/api/health`);
  console.log(`👤 User Login: http://34.229.153.185:${PORT}/`);
  console.log(`🎛️ User Dashboard: http://34.229.153.185:${PORT}/dashboard`);
  console.log(`🔧 Debug Tools: http://34.229.153.185:${PORT}/admin/database`);
  console.log(`✅ SECURITY: Helmet.js is disabled for development`);
});
