// User and device information
let user = null;
let dashboard = { relays: [] };
let deviceStatus = { relays: [] };
let energyChart, usageChart;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    user = JSON.parse(sessionStorage.getItem('user'));
    if (!user) {
        window.location.href = '/';
        return;
    }

    // Initialize user interface
    initializeUserInterface();
    
    // Load dashboard data
    loadDashboard();
    
    // Connect to WebSocket for real-time updates
    connectWebSocket();
    
    // Initialize charts
    initializeCharts();
    
    // Start periodic updates
    startPeriodicUpdates();
});

function initializeUserInterface() {
    // Set user information
    document.getElementById('usernameDisplay').textContent = user.username;
    document.getElementById('deviceIdDisplay').textContent = `Device: ${user.deviceId}`;
    document.getElementById('userAvatar').textContent = user.username.charAt(0).toUpperCase();
    
    // Setup event listeners
    setupEventListeners();
}

function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            // Tab switching logic can be added here
        });
    });

    // Modal forms
    document.getElementById('relayForm').addEventListener('submit', handleRelaySubmit);
    document.getElementById('scheduleForm').addEventListener('submit', handleScheduleSubmit);
}

async function loadDashboard() {
    try {
        const response = await fetch(`/api/dashboard/${user.deviceId}`);
        const data = await response.json();
        
        if (data.success) {
            dashboard = data.dashboard;
            deviceStatus = data.deviceStatus || { relays: [] };
            updateDashboardUI();
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showToast('Error loading dashboard data', 'error');
    }
}

function updateDashboardUI() {
    updateStats();
    renderRelays();
    updateCharts();
    updateSystemStatus();
}

function updateStats() {
    const totalRelays = dashboard.relays.length;
    const activeSchedules = dashboard.relays.reduce((sum, relay) => sum + relay.schedules.length, 0);
    const onlineRelays = deviceStatus.relays ? deviceStatus.relays.filter(r => r.state).length : 0;
    
    document.getElementById('totalRelays').textContent = totalRelays;
    document.getElementById('activeSchedules').textContent = activeSchedules;
    document.getElementById('onlineRelays').textContent = onlineRelays;
    
    // Update uptime if available
    if (deviceStatus.uptime) {
        const hours = Math.floor(deviceStatus.uptime / 3600000);
        document.getElementById('uptime').textContent = `${hours}h`;
    }
}

function renderRelays() {
    const grid = document.getElementById('relaysGrid');
    grid.innerHTML = '';

    dashboard.relays.forEach(relay => {
        const relayStatus = deviceStatus.relays.find(r => r.index === relay.index) || { state: false };
        
        const relayCard = document.createElement('div');
        relayCard.className = `relay-card ${relayStatus.state ? 'active' : ''}`;
        relayCard.innerHTML = `
            <div class="relay-header">
                <div class="relay-name">${relay.name}</div>
                <div class="relay-status ${relayStatus.state ? 'status-on' : 'status-off'}">
                    ${relayStatus.state ? 'ON' : 'OFF'}
                </div>
            </div>
            <div class="relay-info">
                <div style="color: var(--text-light); font-size: 0.9rem; margin-bottom: 10px;">
                    Channel ${relay.index + 1}
                </div>
            </div>
            <div class="relay-actions">
                <button class="btn btn-on" onclick="controlRelay(${relay.index}, 'on')">
                    <i class="fas fa-power-off"></i> ON
                </button>
                <button class="btn btn-off" onclick="controlRelay(${relay.index}, 'off')">
                    <i class="fas fa-power-off"></i> OFF
                </button>
                <button class="btn btn-timer" onclick="setTimer(${relay.index})">
                    <i class="fas fa-hourglass-half"></i> Timer
                </button>
                <button class="btn btn-schedule" onclick="showScheduleModal(${relay.index})">
                    <i class="fas fa-clock"></i> Schedule
                </button>
            </div>
            ${renderSchedules(relay)}
        `;
        grid.appendChild(relayCard);
    });
}

function renderSchedules(relay) {
    if (!relay.schedules || relay.schedules.length === 0) {
        return '<div style="text-align: center; color: var(--text-light); padding: 10px;">No schedules</div>';
    }

    const schedulesHtml = relay.schedules.map((schedule, index) => `
        <div class="schedule-item">
            <div>
                <strong>${schedule.days.map(day => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]).join(',')}</strong>
                <div style="font-size: 0.8rem;">${schedule.startTime} - ${schedule.endTime}</div>
            </div>
            <button class="btn btn-off" style="padding: 4px 8px; font-size: 0.8rem;" 
                    onclick="deleteSchedule(${relay.index}, ${index})">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');

    return `
        <div class="relay-schedules">
            <div style="font-weight: 600; margin-bottom: 10px;">Schedules:</div>
            ${schedulesHtml}
        </div>
    `;
}

function initializeCharts() {
    const energyCtx = document.getElementById('energyChart').getContext('2d');
    const usageCtx = document.getElementById('usageChart').getContext('2d');

    energyChart = new Chart(energyCtx, {
        type: 'line',
        data: {
            labels: ['6AM', '9AM', '12PM', '3PM', '6PM', '9PM'],
            datasets: [{
                label: 'Energy Usage (kWh)',
                data: [2.1, 3.2, 4.5, 3.8, 2.9, 1.5],
                borderColor: '#4CAF50',
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: { display: false }
            }
        }
    });

    usageChart = new Chart(usageCtx, {
        type: 'doughnut',
        data: {
            labels: ['Water Pump', 'Grow Lights', 'Ventilation', 'Heating'],
            datasets: [{
                data: [40, 25, 20, 15],
                backgroundColor: ['#4CAF50', '#FF9800', '#2196F3', '#E91E63']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

function updateCharts() {
    // Update charts with real data when available
    // This is a placeholder for actual data integration
}

function updateSystemStatus() {
    if (deviceStatus) {
        document.getElementById('lastUpdate').textContent = 'Just now';
        document.getElementById('signalStrength').textContent = deviceStatus.rssi ? 
            `${deviceStatus.rssi} dBm` : 'Excellent';
    }
}

// Relay Control Functions
async function controlRelay(relayIndex, action, duration = null) {
    try {
        const response = await fetch(`/api/relay/${user.deviceId}/${relayIndex}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, duration })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast(`Relay ${relayIndex} turned ${action}`, 'success');
        }
    } catch (error) {
        console.error('Error controlling relay:', error);
        showToast('Error controlling relay', 'error');
    }
}

function setTimer(relayIndex) {
    const duration = prompt('Enter timer duration in minutes:');
    if (duration && !isNaN(duration)) {
        controlRelay(relayIndex, 'timer', parseInt(duration) * 60);
    }
}

// Modal Functions
function showAddRelayModal() {
    const modal = document.getElementById('addRelayModal');
    const select = document.getElementById('relayIndex');
    
    // Populate available channels
    select.innerHTML = '<option value="">Select Channel</option>';
    for (let i = 0; i < 20; i++) {
        if (!dashboard.relays.find(r => r.index === i)) {
            select.innerHTML += `<option value="${i}">Channel ${i + 1}</option>`;
        }
    }
    
    modal.style.display = 'flex';
}

function hideAddRelayModal() {
    document.getElementById('addRelayModal').style.display = 'none';
    document.getElementById('relayForm').reset();
}

function showScheduleModal(relayIndex) {
    document.getElementById('scheduleRelayIndex').value = relayIndex;
    document.getElementById('scheduleModal').style.display = 'flex';
}

function hideScheduleModal() {
    document.getElementById('scheduleModal').style.display = 'none';
    document.getElementById('scheduleForm').reset();
}

// Form Handlers
async function handleRelaySubmit(event) {
    event.preventDefault();
    
    const index = parseInt(document.getElementById('relayIndex').value);
    const name = document.getElementById('relayName').value.trim();
    const description = document.getElementById('relayDescription').value.trim();
    
    try {
        const response = await fetch(`/api/dashboard/relay/${user.deviceId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index, name, enabled: true })
        });
        
        const data = await response.json();
        if (data.success) {
            hideAddRelayModal();
            loadDashboard();
            showToast('Relay added successfully', 'success');
        }
    } catch (error) {
        console.error('Error saving relay:', error);
        showToast('Error saving relay', 'error');
    }
}

async function handleScheduleSubmit(event) {
    event.preventDefault();
    
    const relayIndex = parseInt(document.getElementById('scheduleRelayIndex').value);
    const name = document.getElementById('scheduleName').value.trim();
    const days = Array.from(document.querySelectorAll('input[name="days"]:checked'))
        .map(checkbox => parseInt(checkbox.value));
    const startTime = document.getElementById('startTime').value;
    const endTime = document.getElementById('endTime').value;
    const enabled = document.getElementById('scheduleEnabled').checked;
    
    try {
        const response = await fetch(`/api/dashboard/schedule/${user.deviceId}/${relayIndex}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days, startTime, endTime, enabled })
        });
        
        const data = await response.json();
        if (data.success) {
            hideScheduleModal();
            loadDashboard();
            showToast('Schedule added successfully', 'success');
        }
    } catch (error) {
        console.error('Error adding schedule:', error);
        showToast('Error adding schedule', 'error');
    }
}

async function deleteSchedule(relayIndex, scheduleIndex) {
    if (confirm('Are you sure you want to delete this schedule?')) {
        try {
            const response = await fetch(`/api/dashboard/schedule/${user.deviceId}/${relayIndex}/${scheduleIndex}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            if (data.success) {
                loadDashboard();
                showToast('Schedule deleted', 'success');
            }
        } catch (error) {
            console.error('Error deleting schedule:', error);
            showToast('Error deleting schedule', 'error');
        }
    }
}

// WebSocket for real-time updates
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'relay_status') {
            // Update relay status in real-time
            const relayIndex = deviceStatus.relays.findIndex(r => r.index === data.data.relay);
            if (relayIndex !== -1) {
                deviceStatus.relays[relayIndex] = data.data;
            } else {
                deviceStatus.relays.push(data.data);
            }
            updateDashboardUI();
        } else if (data.type === 'device_status') {
            deviceStatus = data.data;
            updateDashboardUI();
        }
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        // Attempt reconnect after 5 seconds
        setTimeout(connectWebSocket, 5000);
    };
}

// Utility Functions
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function startPeriodicUpdates() {
    // Refresh dashboard every 30 seconds
    setInterval(loadDashboard, 30000);
}

function logout() {
    sessionStorage.removeItem('user');
    window.location.href = '/';
}

// Close modals when clicking outside
window.onclick = function(event) {
    const addModal = document.getElementById('addRelayModal');
    const scheduleModal = document.getElementById('scheduleModal');
    
    if (event.target === addModal) hideAddRelayModal();
    if (event.target === scheduleModal) hideScheduleModal();
}
// Schedule Management Functions
async function loadSchedules() {
    try {
        const response = await fetch(`/api/schedules/${user.deviceId}`);
        const data = await response.json();
        
        if (data.success) {
            updateSchedulesUI(data.schedules);
        }
    } catch (error) {
        console.error('Error loading schedules:', error);
    }
}

function updateSchedulesUI(schedules) {
    const schedulesContainer = document.getElementById('schedulesContainer');
    if (!schedulesContainer) return;
    
    if (schedules.length === 0) {
        schedulesContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-light);">
                <i class="fas fa-clock" style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;"></i>
                <div>No schedules configured</div>
                <div style="font-size: 0.9rem; margin-top: 10px;">Add schedules to automate your relays</div>
            </div>
        `;
        return;
    }
    
    schedulesContainer.innerHTML = schedules.map(schedule => `
        <div class="schedule-card">
            <div class="schedule-header">
                <div class="schedule-info">
                    <div class="schedule-name">${schedule.relayName} - ${schedule.startTime} to ${schedule.endTime}</div>
                    <div class="schedule-days">${getDaysText(schedule.days)}</div>
                </div>
                <div class="schedule-status ${schedule.enabled ? 'status-on' : 'status-off'}">
                    ${schedule.enabled ? 'ACTIVE' : 'INACTIVE'}
                </div>
            </div>
            <div class="schedule-actions">
                <button class="btn btn-${schedule.enabled ? 'off' : 'on'}" 
                        onclick="toggleSchedule(${schedule.relayIndex}, ${schedules.indexOf(schedule)})">
                    <i class="fas fa-${schedule.enabled ? 'pause' : 'play'}"></i>
                    ${schedule.enabled ? 'Pause' : 'Activate'}
                </button>
                <button class="btn btn-timer" onclick="testSchedule(${schedule.relayIndex})">
                    <i class="fas fa-play"></i> Test Now
                </button>
                <button class="btn btn-off" onclick="deleteSchedule(${schedule.relayIndex}, ${schedules.indexOf(schedule)})">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
            ${schedule.nextRun ? `
                <div class="schedule-next-run">
                    <i class="fas fa-calendar"></i>
                    Next run: ${schedule.nextRun.date} at ${schedule.nextRun.time}
                    (in ${schedule.nextRun.daysFromNow} day${schedule.nextRun.daysFromNow !== 1 ? 's' : ''})
                </div>
            ` : ''}
        </div>
    `).join('');
}

function getDaysText(days) {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (days.length === 7) return 'Every day';
    if (days.length === 5 && !days.includes(0) && !days.includes(6)) return 'Weekdays';
    if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Weekends';
    return days.map(day => dayNames[day]).join(', ');
}

async function toggleSchedule(relayIndex, scheduleIndex) {
    try {
        const user = await User.findOne({ deviceId: user.deviceId });
        const relay = user.dashboard.relays.find(r => r.index === relayIndex);
        
        if (relay && relay.schedules[scheduleIndex]) {
            relay.schedules[scheduleIndex].enabled = !relay.schedules[scheduleIndex].enabled;
            await user.save();
            
            showToast(`Schedule ${relay.schedules[scheduleIndex].enabled ? 'activated' : 'paused'}`, 'success');
            loadSchedules();
        }
    } catch (error) {
        console.error('Error toggling schedule:', error);
        showToast('Error updating schedule', 'error');
    }
}

async function testSchedule(relayIndex) {
    try {
        await controlRelay(relayIndex, 'on');
        showToast('Testing schedule - relay activated', 'success');
        
        // Turn off after 10 seconds for testing
        setTimeout(() => {
            controlRelay(relayIndex, 'off');
        }, 10000);
    } catch (error) {
        console.error('Error testing schedule:', error);
        showToast('Error testing schedule', 'error');
    }
}

// Enhanced schedule form handler
async function handleScheduleSubmit(event) {
    event.preventDefault();
    
    const relayIndex = parseInt(document.getElementById('scheduleRelayIndex').value);
    const name = document.getElementById('scheduleName').value.trim();
    const days = Array.from(document.querySelectorAll('input[name="days"]:checked'))
        .map(checkbox => parseInt(checkbox.value));
    const startTime = document.getElementById('startTime').value;
    const endTime = document.getElementById('endTime').value;
    const enabled = document.getElementById('scheduleEnabled').checked;
    
    // Validation
    if (days.length === 0) {
        showToast('Please select at least one day', 'error');
        return;
    }
    
    if (startTime >= endTime) {
        showToast('End time must be after start time', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/dashboard/schedule/${user.deviceId}/${relayIndex}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days, startTime, endTime, enabled })
        });
        
        const data = await response.json();
        if (data.success) {
            hideScheduleModal();
            loadDashboard();
            loadSchedules();
            showToast('Schedule added successfully', 'success');
        } else {
            showToast(data.message || 'Error adding schedule', 'error');
        }
    } catch (error) {
        console.error('Error adding schedule:', error);
        showToast('Error adding schedule', 'error');
    }
}

// Enhanced delete schedule function
async function deleteSchedule(relayIndex, scheduleIndex) {
    if (confirm('Are you sure you want to delete this schedule?')) {
        try {
            const response = await fetch(`/api/dashboard/schedule/${user.deviceId}/${relayIndex}/${scheduleIndex}`, {
                method: 'DELETE'
            });
            
            const data = await response.json();
            if (data.success) {
                loadDashboard();
                loadSchedules();
                showToast('Schedule deleted successfully', 'success');
            } else {
                showToast(data.message || 'Error deleting schedule', 'error');
            }
        } catch (error) {
            console.error('Error deleting schedule:', error);
            showToast('Error deleting schedule', 'error');
        }
    }
}

// Initialize schedules when dashboard loads
async function loadDashboard() {
    try {
        const response = await fetch(`/api/dashboard/${user.deviceId}`);
        const data = await response.json();
        
        if (data.success) {
            dashboard = data.dashboard;
            deviceStatus = data.deviceStatus || { relays: [] };
            updateDashboardUI();
            loadSchedules(); // Load schedules after dashboard data
        }
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showToast('Error loading dashboard data', 'error');
    }
}
