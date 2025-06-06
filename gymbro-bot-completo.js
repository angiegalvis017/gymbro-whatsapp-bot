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
let reconnectAttempts = 0;
const userStates = {};

// Configuración
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAYS = [5000, 10000, 15000, 30000, 60000];
const INACTIVITY_TIMEOUT = 15 * 60 * 1000;
const CLEANUP_INTERVAL = 1 * 60 * 1000;

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

// Precios y configuraciones por ubicación
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

function addLog(type, message) {
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
   
  });
});

// APIs del dashboard
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
    addLog('success', `✅ Enviado a ${to.substring(0, 15)}...`);
    return true;
  } catch (error) {
    addLog('error', `❌ Error enviando a ${to}: ${error.message}`);
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

async function checkInactiveUsers(client) {
  try {
    const dbConnected = await testDatabaseConnection();
    if (!dbConnected || !clientReady) {
      addLog('warning', 'Saltando verificación de usuarios inactivos');
      return;
    }

    const [rows] = await pool.query(`
      SELECT 
        telefono, 
        plan_interesado, 
        ultima_interaccion, 
        contratado, 
        fecha_contratacion, 
        plan_duracion,
        fecha_ultimo_recordatorio,
        fecha_ultimo_seguimiento_bimestral,
        CASE 
          WHEN contratado = true THEN 
            DATEDIFF(DATE_ADD(fecha_contratacion, INTERVAL plan_duracion DAY), NOW())
          ELSE NULL
        END as dias_restantes
      FROM interacciones
      WHERE 
        (contratado = false AND ultima_interaccion < NOW() - INTERVAL 48 HOUR)
        OR 
        (contratado = true AND DATE_ADD(fecha_contratacion, INTERVAL plan_duracion - 2 DAY) <= NOW())
    `);

    addLog('info', `Encontrados ${rows.length} usuarios para mensajes de seguimiento`);

    for (const row of rows) {
      let mensaje = '';

      if (!row.contratado) {
        mensaje = `👋 ¡Hola! Te escribimos desde *GYMBRO* 💪\n\n` +
          `¿Aún estás interesad@ en nuestros planes?\n\n` +
          `Responde *Sí* si ya contrataste, o *No* si deseas más información.`;
      } else if (row.dias_restantes !== null && row.dias_restantes <= 2) {
        mensaje = `📅 Hola, tu membresía está próxima a vencer.\n\n` +
          `Te quedan ${row.dias_restantes} días.\n\n` +
          `Para renovar escribe *hola* 💪`;
      }

      if (mensaje) {
        const enviado = await safeSendMessage(client, row.telefono, mensaje);
        if (enviado) {
          addLog('success', `Mensaje de seguimiento enviado a ${row.telefono}`);
          await pool.query(`
            UPDATE interacciones
            SET ultima_interaccion = NOW(), fecha_ultimo_mensaje = NOW()
            WHERE telefono = ?
          `, [row.telefono]);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } catch (error) {
    addLog('error', 'Error verificando usuarios inactivos: ' + error.message);
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
      const inactiveMinutes = Math.floor(inactiveFor / (60 * 1000));
      
      addLog('info', `Usuario ${phone}: inactivo por ${inactiveMinutes} minutos`);
      
      if (inactiveFor > INACTIVITY_TIMEOUT) {
        try {
          const dbConnected = await testDatabaseConnection();
          if (dbConnected) {
            await pool.query(
              'INSERT INTO interacciones (telefono, plan_interesado, ultima_interaccion) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE plan_interesado = ?, ultima_interaccion = ?',
              [phone, state.selectedPlan || null, new Date(state.lastInteraction), state.selectedPlan || null, new Date(state.lastInteraction)]
            );
            addLog('success', `Estado de ${phone} guardado en BD`);
          }
        } catch (error) {
          addLog('error', `Error guardando estado: ${error.message}`);
        }
        
        const sent = await safeSendMessage(client, phone, 
          '⏳ Finalizamos el chat por inactividad. ¡Gracias por tu interés en GYMBRO! 💪\n\n' +
          'Escribe cualquier mensaje para iniciar nuevamente.'
        );
        
        if (sent) {
          addLog('success', `Mensaje de inactividad enviado a ${phone}`);
        }
        
        delete userStates[phone];
        cleanedUsers++;
        addLog('success', `Usuario ${phone} eliminado por inactividad (${inactiveMinutes} minutos)`);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    if (cleanedUsers > 0) {
      addLog('success', `Limpieza completada: ${cleanedUsers} usuarios eliminados por inactividad`);
    } else {
      addLog('info', 'Limpieza completada: Todos los usuarios están activos');
    }
    
    addLog('info', `Usuarios activos restantes: ${Object.keys(userStates).length}`);
    
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

// ========== CONFIGURACIÓN COMPLETA DE MENSAJES ARREGLADA ========== //

function setupMessageHandlers(client) {
  client.on('message', async (message) => {
    try {
      // Filtrar solo mensajes de chat con texto
      if (message.type !== 'chat' || !message.body) {
        return;
      }
      
      const telefono = message.from;
      const text = message.body.toLowerCase().trim();
      
      addLog('info', `📩 ${telefono}: "${text}"`);
      
      if (userStates[telefono]?.redirigiendoAsesor) {
        addLog('info', `🚫 Mensaje ignorado (asesor humano): ${telefono}`);
        return;
      }
      
      // Inicializar estado si no existe
      if (!userStates[telefono]) {
        userStates[telefono] = {
          acceptedTerms: false,
          selectedLocation: null,
          selectedPlan: null,
          contratarState: 'initial',
          lastInteraction: Date.now(),
          waitingForExperience: false,
          redirigiendoAsesor: false,
          followUpState: null // Para manejar seguimientos
        };
        addLog('info', `🆕 Nuevo usuario: ${telefono}`);
      }
      
      userStates[telefono].lastInteraction = Date.now();
      
      // Comandos de prueba simples
      if (text === 'test') {
        await safeSendMessage(client, telefono, '🤖 ¡Bot funcionando! 💪');
        return;
      }
      
      if (text === 'salir' || text === 'finalizar') {
        delete userStates[telefono];
        await safeSendMessage(client, telefono, '👋 Chat finalizado. Escribe cualquier mensaje para volver a empezar.');
        return;
      }

      // MANEJO ESPECÍFICO DE SEGUIMIENTOS - Solo si están en estado de seguimiento
      if (userStates[telefono].followUpState === 'waiting_contract_confirmation') {
        if (text === 'sí' || text === 'si') {
          const dbConnected = await testDatabaseConnection();
          if (dbConnected) {
            await pool.query(`
              UPDATE interacciones
              SET contratado = TRUE, fecha_contratacion = NOW(),
              fecha_ultimo_seguimiento_bimestral = NOW()
              WHERE telefono = ?
            `, [telefono]);
          }

          userStates[telefono].waitingForExperience = true;
          userStates[telefono].followUpState = null;
          await safeSendMessage(client, telefono, '🎉 ¡Genial! ¿Podrías contarnos cómo ha sido tu experiencia con GYMBRO hasta ahora? 💬');
          return;

        } else if (text === 'no') {
          userStates[telefono].followUpState = null;
          await safeSendMessage(client, telefono, '✅ Gracias por tu respuesta. Si necesitas ayuda para iniciar tu plan, estamos disponibles.');
          return;
        }
      }

      // Manejo de experiencias - Solo si están esperando experiencia
      if (userStates[telefono].waitingForExperience) {
        if (text === 'bien' || text === 'mal') {
          const dbConnected = await testDatabaseConnection();
          if (dbConnected) {
            await pool.query(`UPDATE interacciones SET experiencia = ? WHERE telefono = ?`, [text, telefono]);
          }

          await safeSendMessage(client, telefono, '🙏 ¡Gracias por elegirnos! Tus comentarios nos ayudan a mejorar cada día. 💬💪\n\nEstamos siempre para ayudarte.\n\n👋 ¡Hasta pronto!');
          delete userStates[telefono];
          return;
        }

        // Capturar experiencia detallada
        if (text.includes('bien') || text.includes('excelente') || text.includes('mala') || text.length > 3) {
          const dbConnected = await testDatabaseConnection();
          if (dbConnected) {
            await pool.query(`UPDATE interacciones SET experiencia = ? WHERE telefono = ?`, [text, telefono]);
          }

          await safeSendMessage(client, telefono, '🙏 ¡Gracias por elegirnos! Tus comentarios nos ayudan a mejorar cada día. 💬💪\n\nEstamos siempre para ayudarte.\n\n👋 ¡Hasta pronto!');
          delete userStates[telefono];
          return;
        }
      }
      
      // PASO 1: Aceptación de términos
      if (!userStates[telefono].acceptedTerms) {
        if (text === 'acepto') {
          userStates[telefono].acceptedTerms = true;
          addLog('success', `✅ ${telefono} aceptó términos`);
          await safeSendMessage(client, telefono,
            '🏋️‍♂️ ¡Hola, hablas con GABRIELA tu asistente virtual bienvenido a GYMBRO! 🏋️‍♀️\n\n' +
            '¿En cuál de nuestras sedes te encuentras interesad@?\n\n' +
            '📍 Responde con:\n' +
            '1️⃣ - Sede 20 de Julio \n' +
            '2️⃣ - Sede Venecia\n\n' +
            'No olvides seguirnos en nuestras redes sociales https://linktr.ee/GYMBROCOLOMBIA'
          );
          return;
        }
        
        // Cualquier mensaje cuando no ha aceptado términos
        addLog('info', `❓ ${telefono} necesita aceptar términos`);
        await safeSendMessage(client, telefono,
          '👋 ¡Hola! Soy el asistente virtual de *GYMBRO* 💪\n\n' +
          'Para comenzar, necesito que aceptes el tratamiento de tus datos personales según nuestra política de privacidad.\n\n' +
          '✅ Escribe *"acepto"* para continuar.'
        );
        return;
      }
      
      // PASO 2: Selección de sede
      if (!userStates[telefono].selectedLocation) {
        if (text === '1' || text.includes('julio')) {
          userStates[telefono].selectedLocation = '20 de Julio';
          addLog('success', `🏢 ${telefono} seleccionó 20 de Julio`);
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
          return;
        } 
        
        if (text === '2' || text.includes('venecia')) {
          userStates[telefono].selectedLocation = 'Venecia';
          addLog('success', `🏢 ${telefono} seleccionó Venecia`);
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
          return;
        }
        
        // Si no seleccionó sede válida
        await safeSendMessage(client, telefono,
          '📍 Por favor, selecciona una de nuestras sedes para continuar:\n\n' +
          '1️⃣ - Para sede 20 de Julio \n' +
          '2️⃣ - Para sede Venecia'
        );
        return;
      }
      
      // A partir de aquí, el usuario ya seleccionó sede
      const currentLocation = userStates[telefono].selectedLocation;
      addLog('info', `💬 ${telefono} en ${currentLocation}: "${text}"`);
      
      // TODOS LOS PLANES - SEDE 20 DE JULIO
      if (text.includes('motivado') && currentLocation === '20 de Julio') {
        userStates[telefono].selectedPlan = 'motivado';
        const pricing = locationPricing[currentLocation].motivado;
        await safeSendMessage(client, telefono,
          `🔥 *PLAN GYMBRO MOTIVAD@ - SEDE 20 DE JULIO - ${pricing.mensual},000/mes* 🔥\n\n` +
          pricing.beneficios.join('\n') + '\n\n' +
          'Escribe "contratar" para proceder\n' +
          'Escribe "menu" para volver al menú principal'
        );
        return;
      }
      
      if (text.includes('firme') && currentLocation === '20 de Julio') {
        userStates[telefono].selectedPlan = 'firme';
        const pricing = locationPricing[currentLocation].firme;
        await safeSendMessage(client, telefono,
          `⚡ *MEMBRESÍA BIMESTRE FIRME - SEDE 20 DE JULIO - ${pricing.mensual},000* ⚡\n\n` +
          pricing.beneficios.join('\n') + '\n\n' +
          'Escribe "contratar" para proceder\n' +
          'Escribe "menu" para volver al menú principal'
        );
        return;
      }

      if (text.includes('disciplinado') && currentLocation === '20 de Julio') {
        userStates[telefono].selectedPlan = 'disciplinado';
        const pricing = locationPricing[currentLocation].disciplinado;
        await safeSendMessage(client, telefono,
          `🏋️ *MEMBRESÍA TRIMESTRE DISCIPLINAD@ - SEDE 20 DE JULIO - ${pricing.mensual},000* 🏋️\n\n` +
          pricing.beneficios.join('\n') + '\n\n' +
          'Escribe "contratar" para proceder\n' +
          'Escribe "menu" para volver al menú principal'
        );
        return;
      }

      if ((text.includes('superfitt') || text.includes('superfit')) && currentLocation === '20 de Julio') {
        userStates[telefono].selectedPlan = 'superfitt';
        const pricing = locationPricing[currentLocation].superfitt;
        await safeSendMessage(client, telefono,
          `🥇 *MEMBRESÍA SEMESTRE SUPER FITT - SEDE 20 DE JULIO - ${pricing.mensual},000* 🥇\n\n` +
          pricing.beneficios.join('\n') + '\n\n' +
          'Escribe "contratar" para proceder\n' +
          'Escribe "menu" para volver al menú principal'
        );
        return;
      }

      if (text.includes('pro') && currentLocation === '20 de Julio') {
        userStates[telefono].selectedPlan = 'pro';
        const pricing = locationPricing[currentLocation].pro;
        await safeSendMessage(client, telefono,
          `👑 *MEMBRESÍA ANUALIDAD PRO - SEDE 20 DE JULIO - ${pricing.mensual},000* 👑\n\n` +
          pricing.beneficios.join('\n') + '\n\n' +
          'Escribe "contratar" para proceder\n' +
          'Escribe "menu" para volver al menú principal'
        );
        return;
      }
      
      // TODOS LOS PLANES - SEDE VENECIA
      if (text.includes('flash') && currentLocation === 'Venecia') {
        userStates[telefono].selectedPlan = 'flash';
        const pricing = locationPricing[currentLocation].flash;
        await safeSendMessage(client, telefono,
          `⚡ *PLAN GYMBRO FLASH - SEDE VENECIA - ${pricing.mensual},000/mes* ⚡\n\n` +
          pricing.beneficios.join('\n') + '\n\n' +
          'Escribe "contratar" para proceder\n' +
          'Escribe "menu" para volver al menú principal'
        );
        return;
      }

      if (text.includes('class') && currentLocation === 'Venecia') {
        userStates[telefono].selectedPlan = 'class';
        const pricing = locationPricing[currentLocation].class;
        await safeSendMessage(client, telefono,
          `🎓 *PLAN GYMBRO CLASS - SEDE VENECIA - ${pricing.mensual},000/mes* 🎓\n\n` +
          pricing.beneficios.join('\n') + '\n\n' +
          'Escribe "contratar" para proceder\n' +
          'Escribe "menu" para volver al menú principal'
        );
        return;
      }

      if (text.includes('elite') && currentLocation === 'Venecia') {
        userStates[telefono].selectedPlan = 'elite';
        const pricing = locationPricing[currentLocation].elite;
        await safeSendMessage(client, telefono,
          `🎖 *PLAN GYMBRO ELITE - SEDE VENECIA - ${pricing.mensual},000/mes* 🎖\n\n` +
          pricing.beneficios.join('\n') + '\n\n' +
          'Escribe "contratar" para proceder\n' +
          'Escribe "menu" para volver al menú principal'
        );
        return;
      }

      if (text.includes('bro') && !text.includes('trimestre') && !text.includes('semestre') && currentLocation === 'Venecia') {
        userStates[telefono].selectedPlan = 'bro';
        const pricing = locationPricing[currentLocation].bro;
        await safeSendMessage(client, telefono,
          `👥 *PLAN ENTRENA CON TU BRO - SEDE VENECIA - ${pricing.mensual},000/mes* 👥\n\n` +
          pricing.beneficios.join('\n') + '\n\n' +
          'Escribe "contratar" para proceder\n' +
          'Escribe "menu" para volver al menú principal'
        );
        return;
      }

      if (text.includes('trimestre') && currentLocation === 'Venecia') {
        userStates[telefono].selectedPlan = 'trimestre';
        const pricing = locationPricing[currentLocation].trimestre;
        await safeSendMessage(client, telefono,
          `🔄 *PLAN BRO TRIMESTRE - SEDE VENECIA - ${pricing.precio},000* 🔄\n\n` +
          pricing.beneficios.join('\n') + '\n\n' +
          'Escribe "contratar" para proceder\n' +
          'Escribe "menu" para volver al menú principal'
        );
        return;
      }

      if (text.includes('semestre') && currentLocation === 'Venecia') {
        userStates[telefono].selectedPlan = 'semestre';
        const pricing = locationPricing[currentLocation].semestre;
        await safeSendMessage(client, telefono,
          `📆 *PLAN SEMESTRE BRO - SEDE VENECIA - ${pricing.precio},000* 📆\n\n` +
          pricing.beneficios.join('\n') + '\n\n' +
          'Escribe "contratar" para proceder\n' +
          'Escribe "menu" para volver al menú principal'
        );
        return;
      }

      // FLUJO DE CONTRATACIÓN COMPLETO
      if (text.includes('contratar') || userStates[telefono].contratarState === 'waitingForPaymentMethod') {
        const planSolicitado = text.split('contratar')[1]?.trim();

        if (planSolicitado && userStates[telefono].contratarState === 'initial') {
          userStates[telefono].selectedPlan = planSolicitado;
        }

        if (userStates[telefono].selectedPlan && userStates[telefono].contratarState === 'initial') {
          userStates[telefono].contratarState = 'waitingForPaymentMethod';
          await safeSendMessage(client, telefono,
            `✅ ¡Perfecto! Para contratar el plan *${userStates[telefono].selectedPlan}*, selecciona tu método de pago:\n\n` +
            `• Bancolombia/Nequi/Daviplata (Transferencia)\n` +
            `• Addi\n` +
            `• Tarjeta de Crédito/Débito\n` +
            `• Efectivo (En la sede)\n` +
            `• PSE\n` +
            `• Volver al menú principal\n\n` +
            `Puedes escribir el *nombre* del método de pago.`
          );
          return;
        }

        if (userStates[telefono].contratarState === 'waitingForPaymentMethod') {
          userStates[telefono].contratarState = 'initial';

          let metodoPago = null;
          let esperandoCedula = false;

          if (text.includes('bancolombia') || text.includes('nequi') || text.includes('daviplata') || text.includes('transferencia')) {
            metodoPago = 'transferencia';
          } else if (text.includes('addi')) {
            metodoPago = 'addi';
          } else if (text.includes('tarjeta') || text.includes('crédito') || text.includes('débito')) {
            metodoPago = 'tarjeta';
          } else if (text.includes('efectivo')) {
            metodoPago = 'efectivo';
          } else if (text.includes('pse')) {
            metodoPago = 'pse';
          } else if (text === '0' || text.includes('menu') || text.includes('menú')) {
            // Volver al menú principal
          } else {
            await safeSendMessage(client, telefono, '❌ Opción de pago inválida. Por favor, selecciona una opción válida.');
            userStates[telefono].contratarState = 'waitingForPaymentMethod';
            await safeSendMessage(client, telefono,
              `✅ ¡Perfecto! Para contratar el plan *${userStates[telefono].selectedPlan}*, selecciona tu método de pago:\n\n` +
              `• Bancolombia/Nequi/Daviplata (Transferencia)\n` +
              `• Addi\n` +
              `• Tarjeta de Crédito/Débito\n` +
              `• Efectivo (En la sede)\n` +
              `• PSE\n` +
              `• Volver al menú principal\n\n` +
              `Puedes escribir el *nombre* del método de pago.`
            );
            return;
          }

          if (esperandoCedula && /^\d{7,10}$/.test(message.body.trim())) {
            esperandoCedula = false;
            await safeSendMessage(client, telefono, '✅ Gracias, recibimos tu cédula.');
            await safeSendMessage(client, telefono, '🔄 Te estamos transfiriendo con uno de nuestros asesores, espera un momento en línea.');
          }

          if (metodoPago === 'transferencia') {
            let imagePath;
            if (currentLocation === 'Venecia') {
              imagePath = './qr_venecia.jpg';
            } else if (currentLocation === '20 de Julio') {
              imagePath = './qr_20dejulio.jpg';
            }

            if (imagePath) {
              await sendQRCode(client, telefono, imagePath);
              await safeSendMessage(client, telefono, 'Después de realizar tu pago, si eres cliente nuevo, realiza tu inscripción aquí: Registro GYMBRO 👉 https://aplicacion.gymbrocolombia.com/registro/add');
            } else {
              await safeSendMessage(client, telefono, '❌ No se pudo cargar el QR. Por favor, intenta de nuevo.');
            }
          } else if (metodoPago === 'addi') {
            esperandoCedula = true;
            await safeSendMessage(client, telefono, '👉 Para pagar con Addi: requiero tu cédula y te llegará un link a tu celular');
            await safeSendMessage(client, telefono, 'Recuerda enviarnos el comprobante después de realizar tu pago. Si eres cliente nuevo, realiza tu inscripción aquí: Registro GYMBRO 👉 https://aplicacion.gymbrocolombia.com/registro/add');
          } else if (metodoPago === 'tarjeta') {
            await safeSendMessage(client, telefono, `💳 Para pagar con tarjeta, por favor dirígete a la recepción de la sede *${currentLocation}*.`);
          } else if (metodoPago === 'efectivo') {
            await safeSendMessage(client, telefono, `💰 Para pagar en *Efectivo*, por favor dirígete a la recepción de la sede *${currentLocation}*.`);
          } else if (metodoPago === 'pse') {
            await safeSendMessage(client, telefono, '👉 Sigue este enlace para pagar con PSE: https://checkout.wompi.co/l/VPOS_tTb23T');
            await safeSendMessage(client, telefono, 'Recuerda enviarnos el comprobante después de realizar tu pago, si eres cliente nuevo, realiza tu inscripción aquí: Registro GYMBRO 👉 https://aplicacion.gymbrocolombia.com/registro/add');
          }

          userStates[telefono].selectedPlan = null;
          return;
        } else {
          await safeSendMessage(client, telefono, '❓ No pudimos identificar el plan que deseas contratar.\n\nEscribe "2" para volver a ver nuestras membresías.');
          return;
        }
      }
      
      // Información del gimnasio
      if (text === '1' || text.includes('informacion')) {
        let infoExtra = currentLocation === '20 de Julio' ? 
          '❄️ Ambiente climatizado\n🏃‍♂️ Área de cardio ampliada\n' :
          '🏍️ Parqueadero gratis\n📱 App de rutinas\n';
          
        await safeSendMessage(client, telefono,
          `🏋️‍♂️ *INFORMACIÓN GYMBRO - ${currentLocation.toUpperCase()}* 🏋️‍♀️\n\n` +
          '✨ *¿Por qué elegir GYMBRO?*\n\n' +
          '👨‍🏫 Entrenadores profesionales\n' +
          '💪 Máquinas de última tecnología\n' +
          '🚿 Vestuarios amplios y seguros\n' +
          infoExtra +
          '📱 Rutinas personalizadas\n\n' +
          'Escribe "menu" para volver al menú principal.'
        );
        return;
      }
      
      // Membresías y tarifas
    if (text.trim() === '2' || text.includes('membresia')) {
        if (currentLocation === '20 de Julio') {
          await safeSendMessage(client, telefono,
            `💪 *MEMBRESÍAS - SEDE 20 DE JULIO* 💪\n\n` +
            '🔥 *Mes motivad@* - 66,000/mes - Escribe "motivado"\n' +
            '⚡ *Bimestre firme* - 125,000 - Escribe "firme"\n' +
            '🏋️ *Trimestre disciplinad@* - 177,000 - Escribe "disciplinado"\n' +
            '🥇 *Semestre super fitt* - 336,000 - Escribe "superfitt"\n' +
            '👑 *Anualidad pro* - 630,000 - Escribe "pro"\n\n' +
            'Escribe "menu" para volver al menú principal.'
          );
        } else {
          await safeSendMessage(client, telefono,
            `💰 *MEMBRESÍAS - SEDE VENECIA* 💰\n\n` +
            '⚡ *FLASH* - 70,000/mes - Escribe "flash"\n' +
            '🎓 *CLASS* - 55,000/mes - Escribe "class"\n' +
            '🎖 *ELITE* - 55,000/mes - Escribe "elite"\n' +
            '👥 *ENTRENA CON TU BRO* - 130,000/mes - Escribe "bro"\n' +
            '🔄 *TRIMESTRE* - 185,000 - Escribe "trimestre"\n' +
            '📆 *SEMESTRE* - 340,000 - Escribe "semestre"\n\n' +
            'Escribe "menu" para volver al menú principal.'
          );
        }
        return;
      }

      // Otras opciones del menú
      if (text === '3' || text.includes('sede') || text.includes('horario')) {
        await safeSendMessage(client, telefono,
          '📍 *Horarios y Sedes GYMBRO* 🕒\n\n' +
          '*Sede 20 de Julio*\n' +
          '📍 Dirección: Cra. 5a #32 21 Sur\n' +
          '🕐 Horario: Lunes a viernes 5am - 10pm / Sábados 7am - 5pm / Domingos 8am - 4pm\n\n' +
          '*Sede Venecia*\n' +
          '📍 Dirección: Tv. 44 #51b 30 Sur\n' +
          '🕐 Horario: Lunes a viernes 5am - 10pm / Sábados 7am - 5pm / Domingos 8am - 4pm\n\n' +
          'Escribe "menu" para volver al menú principal.'
        );
        return;
      }

      if (text === '4') {
        await safeSendMessage(client, telefono,
          '📅 *Horarios de Clases Grupales*\n\n' +
          '🕐 Lunes a Viernes:\n' +
          '🟢 *7:00 a.m.*\n' +
          '🟢 *7:00 p.m.*\n\n' +
          '💪 Te esperamos para entrenar juntos y mantener la energía al 100%.\n\n' +
          'Escribe *"menu"* para regresar al menú principal.'
        );
        return;
      }

      if (text === '5') {
        await safeSendMessage(client, telefono,
          '🙌 ¡Qué alegría que quieras hacer parte de nuestra familia GYMBRO!\n\n' +
          '📄 Si estás interesado en trabajar con nosotros, envíanos tu hoja de vida al siguiente número de WhatsApp: +57 318 6196126.\n\n' +
          'Te contactaremos si hay una vacante que se ajuste a tu perfil.\n\n' +
          'Escribe *"menu"* para regresar al menú principal.'
        );
        return;
      }

      // Comandos especiales
      if (text.includes('permanencia') || text.includes('atadura') || text.includes('amarrado')) {
        await safeSendMessage(client, telefono,
          '💪 ¡En GYMBRO no tenemos ninguna atadura! Puedes cancelar tu membresía cuando lo desees. Queremos que te quedes porque amas entrenar, no por obligación.\n\n' +
          'Escribe "menu" para volver al menú principal o consulta alguna otra opción.'
        );
        return;
      }

      if (text.includes('asesor')) {
        userStates[telefono].redirigiendoAsesor = true;
        await safeSendMessage(client, telefono,
          '💬 Te estoy redirigiendo a un asesor. Por favor, espera en línea. Un asesor humano continuará la conversación contigo.'
        );
        return;
      }

      if (text.includes('inscripcion') || text.includes('inscripción') || text.includes('registro')) {
        await safeSendMessage(client, telefono,
          '💪 ¡En GYMBRO no cobramos inscripción! Queremos que hagas parte de nuestra familia fitness. Puedes adquirir tu membresía cuando lo desees o acercarte a conocer nuestras instalaciones sin compromiso. ¡Te esperamos!\n\n' +
          'Realiza tu inscripción aquí: Registro GYMBRO 👉 https://aplicacion.gymbrocolombia.com/registro/add\n\n' +
          'Escribe "menu" para volver al menú principal.'
        );
        return;
      }
      
      // Menú principal
      if (text === 'menu' || text === '0') {
        await safeSendMessage(client, telefono,
          `🏋️‍♂️ *MENÚ PRINCIPAL - ${currentLocation.toUpperCase()}* 🏋️‍♀️\n\n` +
          '1️⃣ Información sobre nuestro gimnasio\n' +
          '2️⃣ Membresías y tarifas\n' +
          '3️⃣ Sedes y horarios\n' +
          '4️⃣ Horarios clases grupales\n' +
          '5️⃣ Trabaja con nosotros\n' +
          '0️⃣ Volver al inicio'
        );
        return;
      }
      
      // Mensaje por defecto
      await safeSendMessage(client, telefono,
        '🤖 No entendí tu mensaje. Escribe "menu" para ver las opciones disponibles.\n\n' +
        'Comandos útiles:\n' +
        '• "menu" - Menú principal\n' +
        '• "asesor" - Hablar con humano\n' +
        '• "test" - Probar bot\n' +
        '• "salir" - Finalizar chat'
      );
      
      // Guardar interacción en base de datos
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
      addLog('error', `Error procesando mensaje: ${error.message}`);
      await safeSendMessage(client, telefono, '⚠️ Ocurrió un error. Intenta escribir "test" para verificar que el bot funciona.');
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

    // Verificar usuarios inactivos cada hora
    setInterval(() => {
      if (clientReady && globalClient) {
        checkInactiveUsers(globalClient);
      }
    }, 60 * 60 * 1000);

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
  if (used.heapUsed > 512 * 1024 * 1024) {
  addLog('error', 'Uso de memoria alto (>512MB), reiniciando...');
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