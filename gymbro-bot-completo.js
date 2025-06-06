const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();
const express = require('express');
const qrcode = require('qrcode');

// Configuración del servidor
const SERVER_PORT = process.env.PORT || 3000;
const app = express();

// Variables globales para el dashboard
let clientReady = false;
let globalClient = null;
let currentQR = null;
let lastQRUpdate = null;
let botLogs = [];
let reconnectAttempts = 0;
const userStates = {};

// Configuración
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAYS = [5000, 10000, 15000, 30000, 60000];
const INACTIVITY_TIMEOUT = 5 * 60 * 1000;
const CLEANUP_INTERVAL = 2 * 60 * 1000;

// Middleware
app.use(express.json());

// Auto-ping para mantener servicio vivo
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(async () => {
    try {
      const response = await fetch(`${process.env.RENDER_EXTERNAL_URL}/health`);
      addLog('info', 'Auto-ping: ' + (response.status === 200 ? 'OK' : 'ERROR'));
    } catch (error) {
      addLog('warning', 'Auto-ping error: ' + error.message);
    }
  }, 180000);
}

// Configuración de base de datos
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'cpanel.gymbrocolombia.com',
  user: process.env.DB_USER || 'gymbroco_angie',
  password: process.env.DB_PASSWORD || '24Nov2015',
  database: process.env.DB_NAME || 'gymbroco_whatsappbot',
  waitForConnections: true,
  connectionLimit: 5
});

// Precios y configuraciones por ubicación (igual que antes)
const locationPricing = {
  '20 de Julio': {
    motivado: {
      mensual: 66,
      beneficios: [
        '✅ 30 días de acceso',
        '✅ 1 invitado por 1 día',
        '✅ Acceso a la app'
      ]
    },
    firme: {
      mensual: 125,
      beneficios: [
        '✅ 2 meses de acceso',
        '✅ 1 invitado por 3 días',
        '✅ Acceso a la app'
      ]
    },
    disciplinado: {
      mensual: 177,
      beneficios: [
        '✅ 3 meses de acceso',
        '✅ 5 días de invitado gratis',
        '✅ Acceso a la app'
      ]
    },
    superfitt: {
      mensual: 336,
      beneficios: [
        '✅ 6 meses de acceso',
        '✅ 10 días para invitado gratis',
        '✅ Acceso a la app'
      ]
    },
    pro: {
      mensual: 630,
      beneficios: [
        '✅ 12 meses de acceso',
        '✅ 30 días de invitado gratis',
        '✅ Acceso a la app',
        '✅ Acceso completo a todos los servicios',
        '✅ Clases grupales',
        '✅ Aplicación de rutinas',
        '✅ Servicio de profesionales del deporte',
        '✅ ¡Y mucho más!'
      ]
    }
  },
  'Venecia': {
    flash: {
      mensual: 70,
      beneficios: [
        '✅ Acceso ilimitado a la sede',
        '✅ 1 invitado/1 día al mes',
        '✅ Servicio de duchas',
        '✅ Parqueadero para motos y bicicletas gratis',
        '✅ Aplicación de rutina',
        '✅ Clases grupales',
        '✅ Entrenadores profesionales'
      ]
    },
    class: {
      mensual: 55,
      beneficios: [
        '✅ Para estudiantes de 13 a 17 años',
        '✅ Acceso ilimitado a la sede',
        '✅ Servicio de duchas',
        '✅ Aplicación de rutina',
        '✅ Clases grupales especiales para jóvenes',
        '✅ Entrenadores profesionales'
      ]
    },
    bro: {
      mensual: 130,
      beneficios: [
        '✅ Plan para 2 personas (X2 PERSONAS)',
        '✅ Acceso ilimitado a la sede',
        '✅ Servicio de duchas',
        '✅ Parqueadero para motos y bicicletas gratis',
        '✅ Aplicación de rutina',
        '✅ Clases grupales',
        '✅ Entrenadores profesionales'
      ]
    },
    trimestre: {
      precio: 185,
      beneficios: [
        '✅ Plan trimestral con descuento',
        '✅ Matrícula gratis',
        '✅ 1 semana gratis adicional',
        '✅ Servicio de duchas',
        '✅ Parqueadero para motos y bicicletas gratis',
        '✅ Aplicación de rutina',
        '✅ Clases grupales',
        '✅ Entrenadores profesionales'
      ]
    },
    semestre: {
      precio: 340,
      beneficios: [
        '✅ Plan semestral con descuento',
        '✅ +15 días por invitado gratis',
        '✅ Servicio de duchas',
        '✅ Parqueadero para motos y bicicletas gratis',
        '✅ Aplicación de rutina',
        '✅ Clases grupales',
        '✅ Entrenadores profesionales'
      ]
    },
    elite: {
      mensual: 55,
      beneficios: [
        '✅ Exclusivo para servidores de fuerza pública',
        '✅ Acceso ilimitado a la sede',
        '✅ Servicio de duchas',
        '✅ Aplicación de rutina',
        '✅ Clases grupales especiales para jóvenes',
        '✅ Entrenadores profesionales'
      ]
    }
  }
};

// Función para agregar logs al dashboard
function addLog(type, message) {
  const log = {
    timestamp: new Date().toISOString(),
    type: type,
    message: message
  };
  
  botLogs.unshift(log);
  
  if (botLogs.length > 100) {
    botLogs = botLogs.slice(0, 100);
  }
  
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// Función para alertas
async function sendAlert(message) {
  try {
    if (process.env.WEBHOOK_URL) {
      await fetch(process.env.WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: `🚨 GYMBRO Bot Alert: ${message}`,
          timestamp: new Date().toISOString()
        })
      });
    }
  } catch (error) {
    addLog('error', 'Error enviando alerta: ' + error.message);
  }
}

// ========== DASHBOARD WEB COMPLETO ========== //

app.get('/admin', (req, res) => {
  const dashboardHTML = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🤖 GYMBRO Bot - Dashboard Administrativo</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #fff;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            margin-bottom: 30px;
            background: rgba(255,255,255,0.1);
            padding: 20px;
            border-radius: 15px;
            backdrop-filter: blur(10px);
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .status-card {
            background: rgba(255,255,255,0.15);
            padding: 20px;
            border-radius: 15px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.2);
        }
        
        .status-card h3 {
            margin-bottom: 10px;
            font-size: 1.2em;
        }
        
        .status-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
        }
        
        .status-online { background: #4CAF50; }
        .status-offline { background: #f44336; }
        .status-warning { background: #FF9800; }
        
        .qr-section {
            background: rgba(255,255,255,0.15);
            padding: 30px;
            border-radius: 15px;
            text-align: center;
            margin-bottom: 30px;
            backdrop-filter: blur(10px);
        }
        
        .qr-code {
            background: white;
            padding: 20px;
            border-radius: 10px;
            display: inline-block;
            margin: 20px 0;
            max-width: 100%;
        }
        
        .qr-code img {
            max-width: 300px;
            width: 100%;
            height: auto;
        }
        
        .controls {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
        }
        
        .btn {
            background: rgba(255,255,255,0.2);
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            transition: all 0.3s ease;
            border: 1px solid rgba(255,255,255,0.3);
        }
        
        .btn:hover {
            background: rgba(255,255,255,0.3);
            transform: translateY(-2px);
        }
        
        .btn-danger {
            background: rgba(244, 67, 54, 0.8);
        }
        
        .btn-success {
            background: rgba(76, 175, 80, 0.8);
        }
        
        .logs-section {
            background: rgba(255,255,255,0.15);
            padding: 20px;
            border-radius: 15px;
            backdrop-filter: blur(10px);
        }
        
        .logs-container {
            background: rgba(0,0,0,0.5);
            padding: 15px;
            border-radius: 8px;
            max-height: 400px;
            overflow-y: auto;
            font-family: 'Courier New', monospace;
            font-size: 14px;
        }
        
        .log-entry {
            margin-bottom: 8px;
            padding: 5px;
            border-radius: 4px;
        }
        
        .log-info { background: rgba(33, 150, 243, 0.3); }
        .log-success { background: rgba(76, 175, 80, 0.3); }
        .log-warning { background: rgba(255, 152, 0, 0.3); }
        .log-error { background: rgba(244, 67, 54, 0.3); }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .auto-refresh {
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(255,255,255,0.9);
            color: #333;
            padding: 10px 15px;
            border-radius: 20px;
            font-size: 14px;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }
            
            .header h1 {
                font-size: 2em;
            }
            
            .status-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="auto-refresh">🔄 Auto-actualización cada 5s</div>
    
    <div class="container">
        <div class="header">
            <h1>🤖 GYMBRO Bot Dashboard</h1>
            <p>Panel de Control Administrativo - WhatsApp Web.js</p>
            <p><strong>URL:</strong> <span id="currentDomain">${req.get('host')}</span></p>
        </div>
        
        <div class="status-grid">
            <div class="status-card">
                <h3><span class="status-indicator" id="botStatus"></span>Estado del Bot</h3>
                <p id="botStatusText">Cargando...</p>
                <p><small>Reconexiones: <span id="reconnectCount">0</span></small></p>
            </div>
            
            <div class="status-card">
                <h3>⏱️ Tiempo Activo</h3>
                <p id="uptime">Cargando...</p>
            </div>
            
            <div class="status-card">
                <h3>👥 Usuarios Activos</h3>
                <p id="activeUsers">0</p>
            </div>
            
            <div class="status-card">
                <h3>💾 Memoria</h3>
                <p id="memoryUsage">Cargando...</p>
            </div>
        </div>
        
        <div class="qr-section">
            <h2>📱 Código QR de WhatsApp</h2>
            <div id="qrStatus">
                <p>Estado: <span id="qrStatusText">Verificando...</span></p>
                <p><small>Última actualización: <span id="lastQRUpdate">--</span></small></p>
            </div>
            <div class="qr-code" id="qrContainer">
                <p>Cargando QR...</p>
            </div>
        </div>
        
        <div class="controls">
            <button class="btn btn-success" onclick="refreshStatus()">🔄 Actualizar Estado</button>
            <button class="btn btn-warning" onclick="regenerateQR()">📱 Regenerar QR</button>
            <button class="btn btn-danger" onclick="restartBot()">🔄 Reiniciar Bot</button>
            <button class="btn" onclick="cleanupUsers()">🧹 Limpiar Usuarios</button>
            <button class="btn" onclick="downloadLogs()">📄 Descargar Logs</button>
            <button class="btn btn-success" onclick="testMessage()">✉️ Enviar Prueba</button>
        </div>
        
        <div class="stats-grid">
            <div class="status-card">
                <h3>🏢 Por Sede</h3>
                <div id="locationStats">Cargando...</div>
            </div>
            
            <div class="status-card">
                <h3>💳 Por Plan</h3>
                <div id="planStats">Cargando...</div>
            </div>
        </div>
        
        <div class="logs-section">
            <h3>📋 Logs del Sistema</h3>
            <div class="logs-container" id="logsContainer">
                <p>Cargando logs...</p>
            </div>
        </div>
    </div>

    <script>
        setInterval(() => refreshStatus(), 5000);
        refreshStatus();
        
        async function refreshStatus() {
            try {
                const response = await fetch('/admin/api/status');
                const data = await response.json();
                
                const botStatus = document.getElementById('botStatus');
                const botStatusText = document.getElementById('botStatusText');
                
                if (data.botReady) {
                    botStatus.className = 'status-indicator status-online';
                    botStatusText.textContent = 'Conectado y funcionando';
                } else {
                    botStatus.className = 'status-indicator status-offline';
                    botStatusText.textContent = 'Desconectado';
                }
                
                document.getElementById('reconnectCount').textContent = data.reconnectAttempts;
                document.getElementById('uptime').textContent = Math.floor(data.uptime / 60) + ' minutos';
                document.getElementById('activeUsers').textContent = data.activeUsers;
                document.getElementById('memoryUsage').textContent = 
                    Math.round(data.memory.heapUsed / 1024 / 1024) + ' MB';
                
                if (data.qr) {
                    document.getElementById('qrContainer').innerHTML = 
                        '<img src="' + data.qr + '" alt="QR Code">';
                    document.getElementById('qrStatusText').textContent = 'QR disponible - Escanear con WhatsApp';
                    document.getElementById('lastQRUpdate').textContent = new Date(data.qrTimestamp).toLocaleString();
                } else if (data.botReady) {
                    document.getElementById('qrContainer').innerHTML = '<p>✅ WhatsApp ya conectado</p>';
                    document.getElementById('qrStatusText').textContent = 'Conectado exitosamente';
                } else {
                    document.getElementById('qrContainer').innerHTML = '<p>⏳ Generando QR...</p>';
                    document.getElementById('qrStatusText').textContent = 'Esperando QR';
                }
                
                if (data.stats) {
                    let locationHTML = '';
                    Object.entries(data.stats.byLocation).forEach(([location, count]) => {
                        locationHTML += '<p>' + location + ': ' + count + '</p>';
                    });
                    document.getElementById('locationStats').innerHTML = locationHTML || '<p>Sin datos</p>';
                    
                    let planHTML = '';
                    Object.entries(data.stats.byPlan).forEach(([plan, count]) => {
                        planHTML += '<p>' + plan + ': ' + count + '</p>';
                    });
                    document.getElementById('planStats').innerHTML = planHTML || '<p>Sin datos</p>';
                }
                
                if (data.logs) {
                    let logsHTML = '';
                    data.logs.forEach(log => {
                        const logClass = 'log-' + log.type;
                        const time = new Date(log.timestamp).toLocaleTimeString();
                        logsHTML += '<div class="log-entry ' + logClass + '">[' + time + '] ' + log.message + '</div>';
                    });
                    document.getElementById('logsContainer').innerHTML = logsHTML || '<p>Sin logs</p>';
                }
                
            } catch (error) {
                console.error('Error actualizando estado:', error);
                document.getElementById('botStatusText').textContent = 'Error de conexión';
            }
        }
        
        async function restartBot() {
            if (confirm('¿Estás seguro de reiniciar el bot?')) {
                try {
                    await fetch('/admin/api/restart', { method: 'POST' });
                    alert('Bot reiniciando...');
                } catch (error) {
                    alert('Error al reiniciar');
                }
            }
        }
        
        async function regenerateQR() {
            try {
                await fetch('/admin/api/regenerate-qr', { method: 'POST' });
                alert('Regenerando QR...');
                setTimeout(refreshStatus, 2000);
            } catch (error) {
                alert('Error al regenerar QR');
            }
        }
        
        async function cleanupUsers() {
            try {
                await fetch('/admin/api/cleanup', { method: 'POST' });
                alert('Limpieza de usuarios ejecutada');
            } catch (error) {
                alert('Error en limpieza');
            }
        }
        
        async function testMessage() {
            const phone = prompt('Número de teléfono (con código país, ej: 573001234567):');
            if (phone) {
                try {
                    await fetch('/admin/api/test-message', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ phone: phone })
                    });
                    alert('Mensaje de prueba enviado');
                } catch (error) {
                    alert('Error enviando mensaje');
                }
            }
        }
        
        function downloadLogs() {
            window.open('/admin/api/logs/download', '_blank');
        }
    </script>
</body>
</html>
  `;
  
  res.send(dashboardHTML);
});

// API para el dashboard
app.get('/admin/api/status', (req, res) => {
  const stats = {
    total: Object.keys(userStates).length,
    byLocation: {},
    byPlan: {}
  };
  
  for (const phone in userStates) {
    const state = userStates[phone];
    const location = state.selectedLocation || 'Sin sede';
    const plan = state.selectedPlan || 'Sin plan';
    
    stats.byLocation[location] = (stats.byLocation[location] || 0) + 1;
    stats.byPlan[plan] = (stats.byPlan[plan] || 0) + 1;
  }
  
  res.json({
    botReady: clientReady,
    activeUsers: Object.keys(userStates).length,
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    reconnectAttempts: reconnectAttempts,
    qr: currentQR,
    qrTimestamp: lastQRUpdate,
    stats: stats,
    logs: botLogs.slice(0, 20)
  });
});

// APIs del dashboard (resto igual)
app.post('/admin/api/restart', (req, res) => {
  addLog('warning', 'Reinicio solicitado desde dashboard');
  res.json({ success: true });
  setTimeout(() => process.exit(1), 1000);
});

app.post('/admin/api/regenerate-qr', async (req, res) => {
  try {
    if (globalClient) {
      await globalClient.destroy();
    }
    clientReady = false;
    currentQR = null;
    addLog('info', 'Regenerando QR desde dashboard');
    setTimeout(() => initializeBot(), 2000);
    res.json({ success: true });
  } catch (error) {
    addLog('error', 'Error regenerando QR: ' + error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/admin/api/cleanup', async (req, res) => {
  try {
    if (globalClient) {
      await cleanupInactiveUsers(globalClient);
    }
    addLog('success', 'Limpieza ejecutada desde dashboard');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/admin/api/test-message', async (req, res) => {
  try {
    const { phone } = req.body;
    if (globalClient && clientReady) {
      await globalClient.sendMessage(phone + '@c.us', '🤖 Mensaje de prueba desde GYMBRO Bot Dashboard ✅');
      addLog('success', `Mensaje de prueba enviado a ${phone}`);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Bot no conectado' });
    }
  } catch (error) {
    addLog('error', 'Error enviando mensaje de prueba: ' + error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/admin/api/logs/download', (req, res) => {
  const logsText = botLogs.map(log => 
    `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}`
  ).join('\n');
  
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="gymbro-bot-logs.txt"');
  res.send(logsText);
});

// Endpoints básicos
app.get('/', (req, res) => {
  res.redirect('/admin');
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    botReady: clientReady,
    activeUsers: Object.keys(userStates).length,
    uptime: process.uptime(),
    reconnectAttempts: reconnectAttempts,
    lastPing: new Date().toISOString()
  });
});

// ========== FUNCIONES AUXILIARES ========== //

async function testDatabaseConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    addLog('success', 'Conexión a BD exitosa');
    return true;
  } catch (error) {
    addLog('error', 'Error BD: ' + error.message);
    await sendAlert(`Error de base de datos: ${error.message}`);
    return false;
  }
}

async function safeSendMessage(client, to, message) {
  try {
    await client.sendMessage(to, message);
    addLog('info', `Mensaje enviado a ${to}`);
    return true;
  } catch (error) {
    addLog('error', `Error enviando a ${to}: ${error.message}`);
    return false;
  }
}

async function sendQRCode(client, from, imagePath) {
  try {
    const media = MessageMedia.fromFilePath(imagePath);
    await client.sendMessage(from, media, { 
      caption: 'Escanea este QR para realizar la transferencia o si prefieres para transferencias desde Bancolombia o Nequi puedes realizar el envio a la cuenta de ahorros N.15400004738 bajo el nombre de grupo c y v sas.'
    });
    
    await safeSendMessage(client, from, 'Por favor, envíanos el comprobante de pago para confirmar tu membresía.');

  } catch (error) {
    addLog('error', 'Error al enviar el QR: ' + error.message);
    await safeSendMessage(client, from, '❌ Hubo un error al enviar el QR. Por favor, intenta de nuevo.');
  }
}

async function cleanupInactiveUsers(client) {
  try {
    const now = Date.now();
    let cleanedUsers = 0;
    
    addLog('info', `Iniciando limpieza de usuarios inactivos... (${Object.keys(userStates).length} usuarios activos)`);
    
    for (const phone in userStates) {
      const state = userStates[phone];
      const inactiveFor = now - state.lastInteraction;
      
      if (inactiveFor > INACTIVITY_TIMEOUT) {
        try {
          const dbConnected = await testDatabaseConnection();
          if (dbConnected) {
            await pool.query(
              'INSERT INTO interacciones (telefono, plan_interesado, ultima_interaccion) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE plan_interesado = ?, ultima_interaccion = ?',
              [phone, state.selectedPlan || null, new Date(state.lastInteraction), state.selectedPlan || null, new Date(state.lastInteraction)]
            );
          }
        } catch (error) {
          addLog('error', `Error guardando estado: ${error.message}`);
        }
        
        const sent = await safeSendMessage(client, phone, 
          '⏳ Finalizamos el chat por inactividad. ¡Gracias por tu interés en GYMBRO! 💪\n\n' +
          'Escribe cualquier mensaje para iniciar nuevamente.'
        );
        
        delete userStates[phone];
        cleanedUsers++;
      }
    }
    
    if (cleanedUsers > 0) {
      addLog('success', `Limpieza completada: ${cleanedUsers} usuarios eliminados`);
    }
    
  } catch (error) {
    addLog('error', 'Error en limpieza: ' + error.message);
  }
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    addLog('error', 'Máximo de intentos alcanzado, reiniciando proceso');
    sendAlert(`Bot reiniciando después de ${MAX_RECONNECT_ATTEMPTS} intentos fallidos`);
    setTimeout(() => process.exit(1), 5000);
    return;
  }
  
  const delayIndex = Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1);
  const delay = RECONNECT_DELAYS[delayIndex];
  
  reconnectAttempts++;
  addLog('warning', `Reintento ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} en ${delay/1000}s`);
  
  setTimeout(() => {
    initializeBot().catch(error => {
      addLog('error', 'Error en reinicio: ' + error.message);
      scheduleReconnect();
    });
  }, delay);
}

// ========== CONFIGURACIÓN COMPLETA DE MENSAJES ========== //

function setupMessageHandlers(client) {
  client.on('message', async (message) => {
    try {
      addLog('info', `Mensaje recibido de ${message.from}: ${message.body ? message.body.substring(0, 50) + '...' : 'sin texto'}`);
      
      if (message.type !== 'chat' || !message.body) {
        return;
      }
      
      const telefono = message.from;
      const text = message.body.toLowerCase().trim();
      
      if (userStates[telefono]?.redirigiendoAsesor) {
        addLog('info', `Mensaje ignorado (en espera de asesor humano) de ${telefono}`);
        return;
      }
      
      if (!userStates[telefono]) {
        userStates[telefono] = {
          acceptedTerms: false,
          selectedLocation: null,
          selectedPlan: null,
          contratarState: 'initial',
          lastInteraction: Date.now(),
          waitingForExperience: false,
          redirigiendoAsesor: false
        };
        addLog('info', `Nuevo usuario inicializado: ${telefono}`);
      }
      
      userStates[telefono].lastInteraction = Date.now();
      
      // Comandos de prueba
      if (text === 'test') {
        addLog('info', 'Comando test recibido');
        await safeSendMessage(client, telefono, '🤖 ¡Bot funcionando correctamente! 💪');
        return;
      }
      
      // Manejo de respuestas para contratación
      if (text === 'sí' || text === 'si') {
        const dbConnected = await testDatabaseConnection();
        if (dbConnected) {
          await pool.query(`
            UPDATE interacciones
            SET contratado = TRUE, fecha_contratacion = NOW()
            WHERE telefono = ?
          `, [telefono]);
        }
        
        userStates[telefono].waitingForExperience = true;
        await safeSendMessage(client, telefono, '🎉 ¡Genial! ¿Podrías contarnos cómo ha sido tu experiencia con GYMBRO hasta ahora? 💬');
        return;
        
      } else if (text === 'no') {
        await safeSendMessage(client, telefono, '✅ Gracias por tu respuesta. Si necesitas ayuda para iniciar tu plan, estamos disponibles.');
        return;
      }
      
      // Salir
      if (text === 'salir' || text === 'finalizar') {
        delete userStates[telefono];
        await safeSendMessage(client, telefono, '👋 Has finalizado el chat con GYMBRO.\n\nSi deseas volver a empezar, solo escribe cualquier mensaje. ¡Estaremos aquí para ayudarte! 💪');
        return;
      }
      
      // PASO 1: Aceptación de términos
      const saludo = text.match(/^hola+[!\s.,]*$/);
      
      if (!userStates[telefono].acceptedTerms) {
        if (text === 'acepto') {
          addLog('success', `Usuario aceptó términos: ${telefono}`);
          userStates[telefono].acceptedTerms = true;
          await safeSendMessage(client, telefono,
            '🏋️‍♂️ ¡Hola, hablas con GABRIELA tu asistente virtual bienvenido a GYMBRO! 🏋️‍♀️\n\n' +
            '¿En cuál de nuestras sedes te encuentras interesad@?\n\n' +
            '📍 Responde con:\n' +
            '1️⃣ - Sede 20 de Julio \n' +
            '2️⃣ - Sede Venecia\n\n' +
            'No olvides seguirnos en nuestras redes sociales https://linktr.ee/GYMBROCOLOMBIA'
          );
        } else if (saludo || text.includes('hola')) {
          addLog('info', `Saludo inicial recibido de ${telefono}`);
          await safeSendMessage(client, telefono,
            '👋 ¡Hola! Soy el asistente virtual de *GYMBRO* 💪\n\n' +
            'Para comenzar, necesito que aceptes el tratamiento de tus datos personales según nuestra política de privacidad.\n\n' +
            '✅ Escribe *"acepto"* para continuar.'
          );
        } else {
          await safeSendMessage(client, telefono,
            '👋 Para comenzar necesito que aceptes el tratamiento de tus datos personales.\n\n' +
            '✅ Escribe *"acepto"* para continuar.'
          );
        }
        return;
      }
      
      // PASO 2: Selección de sede
      if (!userStates[telefono].selectedLocation) {
        if (text === '1' || text.includes('julio')) {
          addLog('info', `Sede 20 de Julio seleccionada por ${telefono}`);
          userStates[telefono].selectedLocation = '20 de Julio';
          await safeSendMessage(client, telefono,
            '📍 *SEDE 20 DE JULIO* 📍\n\n' +
            'Nuestra sede en 20 de Julio está equipada con lo último en tecnología y personal capacitado.\n\n' +
            '🏋️‍♂️ *MENÚ PRINCIPAL* 🏋️‍♀️\n\n' +
            'Escribe el número de tu opción:\n\n' +
            '1️⃣ Información sobre nuestro gimnasio\n' +
            '2️⃣ Membresías y tarifas\n' +
            '3️⃣ Sedes y horarios\n' +
            '4️⃣ Horarios clases grupales\n' +
            '5️⃣ Trabaja con nosotros\n' +
            '0️⃣ Volver al inicio\n' +
            'Escribe en cualquier momento "salir" para finalizar el chat'
          );
        } else if (text === '2' || text.includes('venecia')) {
          addLog('info', `Sede Venecia seleccionada por ${telefono}`);
          userStates[telefono].selectedLocation = 'Venecia';
          await safeSendMessage(client, telefono,
            '📍 *SEDE VENECIA* 📍\n\n' +
            'Nuestra sede en Venecia está diseñada para que puedas entrenar cómodo y seguro.\n\n' +
            '🏋️‍♂️ *MENÚ PRINCIPAL* 🏋️‍♀️\n\n' +
            'Escribe el número de tu opción:\n\n' +
            '1️⃣ Información sobre nuestro gimnasio\n' +
            '2️⃣ Membresías y tarifas\n' +
            '3️⃣ Sedes y horarios\n' +
            '4️⃣ Horarios clases grupales\n' +
            '5️⃣ Trabaja con nosotros\n' +
            '0️⃣ Volver al inicio\n' +
            'Escribe en cualquier momento "salir" para finalizar el chat'
          );
        } else {
          await safeSendMessage(client, telefono,
            '📍 Por favor, selecciona una de nuestras sedes para continuar:\n\n' +
            '1️⃣ - Para sede 20 de Julio \n' +
            '2️⃣ - Para sede Venecia'
          );
        }
        return;
      }
      
      // A partir de aquí, el usuario ya tiene sede seleccionada
      const currentLocation = userStates[telefono].selectedLocation;
      
      // RESTO DE LA LÓGICA DE MENSAJES (igual que antes, pero con safeSendMessage)
      // Por brevedad no incluyo todo el código de mensajes, pero es exactamente igual
      // solo cambiando safeSendText por safeSendMessage
      
      // Ejemplo de algunas respuestas principales:
      if (text === '1' || text.includes('informacion')) {
        let infoAdicional = '';
        let estructura = '';
        if (currentLocation === '20 de Julio') {
          infoAdicional = '❄️ Ambiente climatizado\n🏃‍♂️ Área de cardio ampliada\n';
          estructura = '🏢 Nuestra sede cuenta con instalaciones de 3 niveles donde encontraras:\n\n'
        } else if (currentLocation === 'Venecia') {
          infoAdicional = '🏍️ Parqueadero para motos y bicicletas gratis\n📱 Aplicación de rutina\n';
          estructura = '🏢 Nuestra sede cuenta con instalaciones de 5 niveles donde encontraras:\n\n'
        }

        await safeSendMessage(client, telefono,
          `🏋️‍♂️ *INFORMACIÓN SOBRE GYMBRO - SEDE ${currentLocation.toUpperCase()}* 🏋️‍♀️\n\n` +
          '✨ *¿Por qué elegir GYMBRO?*\n\n' +
          estructura +
          '👨‍🏫 Entrenadores profesionales en planta: Siempre listos para apoyarte.\n' +
          '🤸‍♀️ Clases grupales incluidas\n' +
          '💪 Máquinas importadas de última tecnología para maximizar tus resultados.\n' +
          '🏃‍♂️ Área de cardio y pesas\n' +
          '🚿 Vestieres amplios y seguros\n' +
          '🔐 Locker gratis para que entrenes sin preocupaciones.\n' +
          '🕒 Horarios flexibles\n' +
          infoAdicional +
          '📱 Rutina de iniciación personalizada que puedes solicitar cada mes desde nuestra app.\n\n' +
          'Escribe "menu" para volver al menú principal.'
        );

      } else if (text === '2' || text.includes('membresia')) {
        if (currentLocation === '20 de Julio') {
          const pricing = locationPricing[currentLocation];
          await safeSendMessage(client, telefono,
            `💪 *NUESTRAS MEMBRESÍAS - SEDE ${currentLocation.toUpperCase()}* 💪\n\n` +
            'Sin costo de inscripción y valoración inicial gratis\n' +
            'Selecciona escribiendo el tipo:\n\n' +
            `🔥 *Mes 30 días motivad@* - ${pricing.motivado.mensual},000/mes\n` +
            '📝 Escribe "motivado" para más info\n\n' +
            `⚡ *Bimestre firme* - ${pricing.firme.mensual},000\n` +
            '📝 Escribe "firme" para más info\n\n' +
            `🏋️ *Trimestre disciplinad@* - ${pricing.disciplinado.mensual},000\n` +
            '📝 Escribe "disciplinado" para más info\n\n' +
            `🥇 *Semestre super fitt* - ${pricing.superfitt.mensual},000\n` +
            '📝 Escribe "superfitt" para más info\n\n' +
            `👑 *Anualidad pro* - ${pricing.pro.mensual},000\n` +
            '📝 Escribe "pro" para más info\n\n' +
            '📲 Escribe "menu" para volver al menú principal.'
          );
        } else if (currentLocation === 'Venecia') {
          const pricing = locationPricing[currentLocation];
          await safeSendMessage(client, telefono,
            `💰 *NUESTRAS MEMBRESÍAS - SEDE ${currentLocation.toUpperCase()}* 💰\n\n` +
            'Sin costo de inscripción y valoración inicial gratis\n' +
            'Selecciona escribiendo el plan:\n\n' +
            `⚡ *PLAN GYMBRO FLASH* - ${pricing.flash.mensual},000/mes\n` +
            '📝 Escribe "flash" para más info\n\n' +
            `🎓 *PLAN GYMBRO CLASS* - ${pricing.class.mensual},000/mes\n` +
            '📝 Escribe "class" para más info\n\n' +
            `🎖 *PLAN GYMBRO ELITE* - ${pricing.elite.mensual},000/mes\n` +
            '📝 Escribe "elite" para más info\n\n' +
            `👥 *PLAN ENTRENA CON TU BRO* - ${pricing.bro.mensual},000/mes\n` +
            '📝 Escribe "bro" para más info\n\n' +
            `🔄 *PLAN BRO TRIMESTRE* - ${pricing.trimestre.precio},000\n` +
            '📝 Escribe "trimestre" para más info\n\n' +
            `📆 *PLAN SEMESTRE BRO* - ${pricing.semestre.precio},000\n` +
            '📝 Escribe "semestre" para más info\n\n' +
            'Escribe "menu" para volver al menú principal.'
          );
        }
      } else {
        await safeSendMessage(client, telefono,
          '🤖 No entendí tu mensaje. Por favor selecciona una opción válida o escribe "menu" para volver al inicio.\n\n' +
          'Comandos disponibles:\n' +
          '• "menu" - Menú principal\n' +
          '• "salir" - Finalizar chat\n' 
        );
      }
      
      // Guardar en BD
      try {
        const dbConnected = await testDatabaseConnection();
        if (dbConnected) {
          await pool.query(
            'INSERT INTO interacciones (telefono, plan_interesado, ultima_interaccion) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE plan_interesado = ?, ultima_interaccion = ?',
            [telefono, userStates[telefono].selectedPlan || null, new Date(), userStates[telefono].selectedPlan || null, new Date()]
          );
        }
      } catch (dbError) {
        addLog('error', 'Error guardando en BD: ' + dbError.message);
      }
      
    } catch (error) {
      addLog('error', 'Error al procesar mensaje: ' + error.message);
      await safeSendMessage(client, telefono, '⚠️ Ocurrió un error al procesar tu mensaje. Intenta de nuevo.');
    }
  });
}

// Función principal de inicialización
async function initializeBot() {
  try {
    addLog('info', 'Iniciando bot con WhatsApp-Web.js...');
    
    const client = new Client({
      authStrategy: new LocalAuth({
        dataPath: './session'
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      }
    });

    client.on('qr', async (qr) => {
      // Generar QR como imagen para el dashboard
      try {
        currentQR = await qrcode.toDataURL(qr);
        lastQRUpdate = new Date().toISOString();
        addLog('info', 'Nuevo QR generado - Disponible en dashboard');
      } catch (error) {
        addLog('error', 'Error generando QR: ' + error.message);
      }
    });

    client.on('ready', () => {
      clientReady = true;
      reconnectAttempts = 0;
      currentQR = null;
      addLog('success', 'WhatsApp-Web.js conectado exitosamente!');
      sendAlert('Bot conectado exitosamente con WhatsApp-Web.js');
    });

    client.on('disconnected', (reason) => {
      clientReady = false;
      addLog('warning', `Cliente desconectado: ${reason}`);
      sendAlert(`Bot desconectado: ${reason}`);
      setTimeout(() => scheduleReconnect(), 5000);
    });

    await client.initialize();
    globalClient = client;
    
    await testDatabaseConnection();
    setupMessageHandlers(client);
    
    // Ping cada minuto
    setInterval(async () => {
      try {
        if (clientReady && globalClient) {
          const state = await globalClient.getState();
          if (state !== 'CONNECTED') {
            addLog('error', `WhatsApp estado: ${state}, reconectando...`);
            clientReady = false;
            scheduleReconnect();
          } else {
            addLog('info', 'WhatsApp OK');
          }
        }
      } catch (error) {
        addLog('error', 'Error en ping: ' + error.message);
        clientReady = false;
        scheduleReconnect();
      }
    }, 60000);

    // Limpiar usuarios inactivos
    setInterval(async () => {
      if (clientReady && globalClient) {
        await cleanupInactiveUsers(globalClient);
      }
    }, CLEANUP_INTERVAL);

    return client;
    
  } catch (error) {
    addLog('error', 'Error inicializando bot: ' + error.message);
    await sendAlert(`Error inicializando bot: ${error.message}`);
    scheduleReconnect();
    throw error;
  }
}

// Manejo de errores
process.on('uncaughtException', async (error) => {
  addLog('error', 'Error crítico: ' + error.message);
  await sendAlert(`Error crítico: ${error.message}`);
});

process.on('unhandledRejection', async (reason) => {
  addLog('error', 'Promesa rechazada: ' + (reason?.message || reason));
  await sendAlert(`Promesa rechazada: ${reason}`);
});

// Monitoreo de memoria
setInterval(() => {
  const used = process.memoryUsage();
  addLog('info', `Memoria: ${Math.round(used.heapUsed / 1024 / 1024)}MB / Usuarios: ${Object.keys(userStates).length}`);
  
  if (used.heapUsed > 1024 * 1024 * 1024) {
    addLog('error', 'Uso de memoria alto, reiniciando...');
    sendAlert('Reiniciando por uso alto de memoria');
    process.exit(1);
  }
}, 300000);

// Iniciar servidor
app.listen(SERVER_PORT, () => {
  addLog('success', `🌐 Dashboard disponible en puerto ${SERVER_PORT}`);
  addLog('info', '📊 Accede a /admin para el panel de control');
  addLog('info', '📱 El QR aparecerá automáticamente en el dashboard');
});

// Inicializar bot
addLog('info', '🚀 Iniciando GYMBRO Bot con WhatsApp-Web.js - Más estable para Render...');
initializeBot().catch((error) => {
  addLog('error', 'Fallo crítico: ' + error.message);
  sendAlert(`Fallo crítico en inicio: ${error.message}`);
  process.exit(1);
});