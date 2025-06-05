const venom = require('venom-bot');
const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
require('dotenv').config();
const express = require('express');

// Agregar después de tus configuraciones globales
const PORT = process.env.PORT || 3000;
const app = express();

// Middleware
app.use(express.json());

// Endpoints para Railway
app.get('/', (req, res) => {
  res.json({ 
    status: '🤖 GYMBRO Bot funcionando en Railway! 💪', 
    timestamp: new Date().toISOString(),
    activeUsers: Object.keys(userStates).length,
    botReady: clientReady,
    uptime: process.uptime()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    botReady: clientReady,
    activeUsers: Object.keys(userStates).length,
    memory: process.memoryUsage(),
    uptime: process.uptime()
  });
});

app.get('/stats', (req, res) => {
  const now = Date.now();
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
  
  res.json(stats);
});

// Iniciar servidor Express
app.listen(PORT, () => {
  console.log(`🌐 Servidor HTTP funcionando en puerto ${PORT}`);
  console.log(`📊 Endpoints disponibles:`);
  console.log(`   - GET / (status general)`);
  console.log(`   - GET /health (salud del bot)`);
  console.log(`   - GET /stats (estadísticas de usuarios)`);
});

console.log('🚀 Iniciando GYMBRO Bot Completo - Versión Corregida...');

// Variable global para controlar el estado del cliente
let clientReady = false;
let globalClient = null;

// Estados de usuario
const userStates = {};

// Función de reconexión automática
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Configuración de inactividad
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutos para pruebas (cambia a 20 * 60 * 1000 para producción)
const CLEANUP_INTERVAL = 2 * 60 * 1000; // Verificar cada 2 minutos

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

// Función para encontrar Chromium de Puppeteer automáticamente
function findPuppeteerChrome() {
  // En Railway/producción, usar configuración optimizada para contenedores
  console.log('🐳 Ejecutándose en entorno de contenedor');
  return null; // Dejar que venom use su configuración por defecto
}

// Funciones auxiliares
async function testDatabaseConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('✅ Conexión a BD exitosa');
    return true;
  } catch (error) {
    console.error('❌ Error BD:', error.message);
    return false;
  }
}

async function safeSendText(client, to, message) {
  try {
    await client.sendText(to, message);
    console.log(`✅ Mensaje enviado a ${to}`);
    return true;
  } catch (error) {
    console.error(`❌ Error enviando a ${to}:`, error.message);
    return false;
  }
}

async function imageToBase64(imagePath) {
  try {
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    return `data:image/png;base64,${base64Image}`;
  } catch (error) {
    console.error('❌ Error al convertir imagen a base64:', error);
    return null;
  }
}

async function sendQRCode(client, from, base64Image) {
  try {
    if (!base64Image) {
      await safeSendText(client, from, '❌ No se pudo cargar el QR. Por favor, intenta de nuevo.');
      return;
    }

    const tempFilePath = path.join(__dirname, `temp_qr_${Date.now()}.png`);
    const base64Data = base64Image.split(';base64,').pop();

    await fs.writeFile(tempFilePath, base64Data, 'base64');
    await client.sendImage(from, tempFilePath, 'QR para transferencia', 'Escanea este QR para realizar la transferencia o si prefieres para transferencias desde Bancolombia o Nequi puedes realizar el envio a la cuenta de ahorros N.15400004738 bajo el nombre de grupo c y v sas.');
    
    try {
      await fs.unlink(tempFilePath);
    } catch (unlinkError) {
      console.error('⚠️ Error eliminando archivo temporal:', unlinkError);
    }

    await safeSendText(client, from, 'Por favor, envíanos el comprobante de pago para confirmar tu membresía.');

  } catch (error) {
    console.error('❌ Error al enviar el QR:', error);
    await safeSendText(client, from, '❌ Hubo un error al enviar el QR. Por favor, intenta de nuevo.');
  }
}

async function checkInactiveUsers(client) {
  try {
    const dbConnected = await testDatabaseConnection();
    if (!dbConnected || !clientReady) {
      console.log('⚠️ Saltando verificación de usuarios inactivos');
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

    console.log(`🔍 Encontrados ${rows.length} usuarios para mensajes de seguimiento`);

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
        const enviado = await safeSendText(client, row.telefono, mensaje);
        if (enviado) {
          console.log(`📩 Mensaje de seguimiento enviado a ${row.telefono}`);
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
    console.error('❌ Error verificando usuarios inactivos:', error);
  }
}

// Función de limpieza de usuarios inactivos (mejorada)
async function cleanupInactiveUsers(client) {
  try {
    const now = Date.now();
    let cleanedUsers = 0;
    
    console.log(`🧹 Iniciando limpieza de usuarios inactivos... (${Object.keys(userStates).length} usuarios activos)`);
    
    for (const phone in userStates) {
      const state = userStates[phone];
      const inactiveFor = now - state.lastInteraction;
      const inactiveMinutes = Math.floor(inactiveFor / (60 * 1000));
      
      console.log(`📱 Usuario ${phone}: inactivo por ${inactiveMinutes} minutos`);
      
      if (inactiveFor > INACTIVITY_TIMEOUT) {
        try {
          // Guardar en base de datos antes de limpiar
          const dbConnected = await testDatabaseConnection();
          if (dbConnected) {
            await pool.query(
              'INSERT INTO interacciones (telefono, plan_interesado, ultima_interaccion) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE plan_interesado = ?, ultima_interaccion = ?',
              [phone, state.selectedPlan || null, new Date(state.lastInteraction), state.selectedPlan || null, new Date(state.lastInteraction)]
            );
            console.log(`💾 Estado de ${phone} guardado en BD`);
          }
        } catch (error) {
          console.error('❌ Error guardando estado de', phone, ':', error);
        }
        
        // Enviar mensaje de inactividad
        const sent = await safeSendText(client, phone, 
          '⏳ Finalizamos el chat por inactividad. ¡Gracias por tu interés en GYMBRO! 💪\n\n' +
          'Escribe cualquier mensaje para iniciar nuevamente.'
        );
        
        if (sent) {
          console.log(`📤 Mensaje de inactividad enviado a ${phone}`);
        }
        
        // Eliminar del estado
        delete userStates[phone];
        cleanedUsers++;
        console.log(`🗑️ Usuario ${phone} eliminado por inactividad (${inactiveMinutes} minutos)`);
        
        // Esperar un poco entre mensajes
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    if (cleanedUsers > 0) {
      console.log(`✅ Limpieza completada: ${cleanedUsers} usuarios eliminados por inactividad`);
    } else {
      console.log(`✅ Limpieza completada: Todos los usuarios están activos`);
    }
    
    console.log(`📊 Usuarios activos restantes: ${Object.keys(userStates).length}`);
    
  } catch (error) {
    console.error('❌ Error en limpieza de usuarios inactivos:', error);
  }
}

// Función para mostrar estadísticas de usuarios
function showUserStats() {
  const now = Date.now();
  const stats = {
    total: Object.keys(userStates).length,
    byLocation: {},
    byPlan: {},
    inactivityLevels: {
      '0-2min': 0,
      '2-5min': 0,
      '5-10min': 0,
      '10-20min': 0,
      '20+min': 0
    }
  };
  
  for (const phone in userStates) {
    const state = userStates[phone];
    const inactiveFor = now - state.lastInteraction;
    const inactiveMinutes = Math.floor(inactiveFor / (60 * 1000));
    
    // Por ubicación
    const location = state.selectedLocation || 'Sin sede';
    stats.byLocation[location] = (stats.byLocation[location] || 0) + 1;
    
    // Por plan
    const plan = state.selectedPlan || 'Sin plan';
    stats.byPlan[plan] = (stats.byPlan[plan] || 0) + 1;
    
    // Por nivel de inactividad
    if (inactiveMinutes < 2) stats.inactivityLevels['0-2min']++;
    else if (inactiveMinutes < 5) stats.inactivityLevels['2-5min']++;
    else if (inactiveMinutes < 10) stats.inactivityLevels['5-10min']++;
    else if (inactiveMinutes < 20) stats.inactivityLevels['10-20min']++;
    else stats.inactivityLevels['20+min']++;
  }
  
  console.log('📊 ESTADÍSTICAS DE USUARIOS:', JSON.stringify(stats, null, 2));
}

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
});

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('❌ Máximo de intentos de reconexión alcanzado');
    process.exit(1);
  }
  
  reconnectAttempts++;
  const delay = Math.min(30000 * reconnectAttempts, 300000); // Max 5 minutos
  
  console.log(`🔄 Reintentando conexión en ${delay/1000} segundos (intento ${reconnectAttempts})`);
  
  setTimeout(() => {
    initializeBot().catch(console.error);
  }, delay);
}

// Función separada para configurar manejadores de mensajes
function setupMessageHandlers(client) {
  client.onMessage(async (message) => {
    try {
      // Debug: mostrar todos los mensajes recibidos
      console.log('🔥 MENSAJE RECIBIDO:', {
        type: message.type,
        body: message.body ? message.body.substring(0, 50) + '...' : 'sin texto',
        from: message.from,
        sender: message.sender?.pushname || 'Desconocido'
      });
      
      // Filtrar solo mensajes de chat con texto
      if (message.type !== 'chat' || !message.body) {
        return;
      }
      
      const telefono = message.from;
      const text = message.body.toLowerCase().trim();
      
      console.log(`📩 Procesando: "${text}" de ${message.sender?.pushname || 'Usuario'}`);
      
      // Verificar si está siendo redirigido a asesor
      if (userStates[telefono]?.redirigiendoAsesor) {
        console.log(`🤖 Mensaje ignorado (en espera de asesor humano).`);
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
          redirigiendoAsesor: false
        };
        console.log('🆕 Nuevo usuario inicializado:', telefono);
      }
      
      userStates[telefono].lastInteraction = Date.now();
      
      // Comandos de prueba y administración
      if (text === 'test') {
        console.log('🧪 Comando test recibido');
        await safeSendText(client, telefono, '🤖 ¡Bot funcionando correctamente! 💪');
        return;
      }
      
      if (text === 'cleanup' || text === 'limpiar') {
        console.log('🧪 Comando cleanup recibido');
        await cleanupInactiveUsers(client);
        await safeSendText(client, telefono, '🧹 Limpieza de usuarios inactivos ejecutada');
        return;
      }
      
      if (text === 'stats' || text === 'estadisticas') {
        console.log('🧪 Comando stats recibido');
        showUserStats();
        await safeSendText(client, telefono, `📊 Usuarios activos: ${Object.keys(userStates).length}`);
        return;
      }
      
      // Manejo de respuestas para el flujo de contratación
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
        await safeSendText(client, telefono, '🎉 ¡Genial! ¿Podrías contarnos cómo ha sido tu experiencia con GYMBRO hasta ahora? 💬');
        return;
        
      } else if (text === 'no') {
        await safeSendText(client, telefono, '✅ Gracias por tu respuesta. Si necesitas ayuda para iniciar tu plan, estamos disponibles.');
        return;
      }
      
      // Manejo de experiencias
      if (text === 'bien' || text === 'mal') {
        const dbConnected = await testDatabaseConnection();
        if (dbConnected) {
          await pool.query(`UPDATE interacciones SET experiencia = ? WHERE telefono = ?`, [text, telefono]);
        }
        
        await safeSendText(client, telefono, '🙏 ¡Gracias por elegirnos! Tus comentarios nos ayudan a mejorar cada día. 💬💪\n\nEstamos siempre para ayudarte.\n\n👋 ¡Hasta pronto!');
        delete userStates[telefono];
        return;
      }
      
      // Capturar experiencia detallada
      if (userStates[telefono].waitingForExperience && 
          (text.includes('bien') || text.includes('excelente') || text.includes('mala') || text.length > 3)) {
        const dbConnected = await testDatabaseConnection();
        if (dbConnected) {
          await pool.query(`UPDATE interacciones SET experiencia = ? WHERE telefono = ?`, [text, telefono]);
        }
        
        await safeSendText(client, telefono, '🙏 ¡Gracias por elegirnos! Tus comentarios nos ayudan a mejorar cada día. 💬💪\n\nEstamos siempre para ayudarte.\n\n👋 ¡Hasta pronto!');
        delete userStates[telefono];
        return;
      }
      
      // Comando para salir
      if (text === 'salir' || text === 'finalizar' || text.includes('cerrar chat')) {
        const dbConnected = await testDatabaseConnection();
        if (dbConnected) {
          await pool.query(
            'INSERT INTO interacciones (telefono, plan_interesado, ultima_interaccion) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE plan_interesado = ?, ultima_interaccion = ?',
            [telefono, userStates[telefono].selectedPlan || null, new Date(), userStates[telefono].selectedPlan || null, new Date()]
          );
        }
        
        delete userStates[telefono];
        await safeSendText(client, telefono, '👋 Has finalizado el chat con GYMBRO.\n\nSi deseas volver a empezar, solo escribe cualquier mensaje. ¡Estaremos aquí para ayudarte! 💪');
        return;
      }
      
      // PASO 1: Verificar aceptación de términos
      const saludo = text.match(/^hola+[!\s.,]*$/);
      
      if (!userStates[telefono].acceptedTerms) {
        if (text === 'acepto') {
          console.log('✅ Usuario aceptó términos');
          userStates[telefono].acceptedTerms = true;
          await safeSendText(client, telefono,
            '🏋️‍♂️ ¡Hola, hablas con GABRIELA tu asistente virtual bienvenido a GYMBRO! 🏋️‍♀️\n\n' +
            '¿En cuál de nuestras sedes te encuentras interesad@?\n\n' +
            '📍 Responde con:\n' +
            '1️⃣ - Sede 20 de Julio \n' +
            '2️⃣ - Sede Venecia\n\n' +
            'No olvides seguirnos en nuestras redes sociales https://linktr.ee/GYMBROCOLOMBIA'
          );
        } else if (saludo || text.includes('hola')) {
          console.log('👋 Saludo inicial recibido');
          await safeSendText(client, telefono,
            '👋 ¡Hola! Soy el asistente virtual de *GYMBRO* 💪\n\n' +
            'Para comenzar, necesito que aceptes el tratamiento de tus datos personales según nuestra política de privacidad.\n\n' +
            '✅ Escribe *"acepto"* para continuar.'
          );
        } else {
          console.log('❓ Mensaje sin aceptar términos');
          await safeSendText(client, telefono,
            '👋 Para comenzar necesito que aceptes el tratamiento de tus datos personales.\n\n' +
            '✅ Escribe *"acepto"* para continuar.'
          );
        }
        return;
      }
      
      // PASO 2: Verificar selección de sede
      if (!userStates[telefono].selectedLocation) {
        if (text === '1' || text.includes('julio')) {
          console.log('🏢 Sede 20 de Julio seleccionada');
          userStates[telefono].selectedLocation = '20 de Julio';
          await safeSendText(client, telefono,
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
          console.log('🏢 Sede Venecia seleccionada');
          userStates[telefono].selectedLocation = 'Venecia';
          await safeSendText(client, telefono,
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
          console.log('❓ Selección de sede inválida');
          await safeSendText(client, telefono,
            '📍 Por favor, selecciona una de nuestras sedes para continuar:\n\n' +
            '1️⃣ - Para sede 20 de Julio \n' +
            '2️⃣ - Para sede Venecia'
          );
        }
        return;
      }
      
      // A partir de aquí, el usuario ya aceptó términos y seleccionó sede
      const currentLocation = userStates[telefono].selectedLocation;
      
      // MENÚ PRINCIPAL y otras opciones
      if (text === '1' || text.includes('informacion') || text.includes('información')) {
        let infoAdicional = '';
        let estructura = '';
        if (currentLocation === '20 de Julio') {
          infoAdicional = '❄️ Ambiente climatizado\n🏃‍♂️ Área de cardio ampliada\n';
          estructura = '🏢 Nuestra sede cuenta con instalaciones de 3 niveles donde encontraras:\n\n'
        } else if (currentLocation === 'Venecia') {
          infoAdicional = '🏍️ Parqueadero para motos y bicicletas gratis\n📱 Aplicación de rutina\n';
          estructura = '🏢 Nuestra sede cuenta con instalaciones de 5 niveles donde encontraras:\n\n'
        }

        await safeSendText(client, telefono,
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

      } else if (text.includes('membresia') || text.includes('membresía') || text.includes('tarifas') || text.includes('precios') || text === '2') {
        if (currentLocation === '20 de Julio') {
          const pricing = locationPricing[currentLocation];
          await safeSendText(client, telefono,
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
          await safeSendText(client, telefono,
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

      } else if (text.includes('motivado')) {
        if (currentLocation === '20 de Julio') {
          userStates[telefono].selectedPlan = 'motivado';
          const pricing = locationPricing[currentLocation].motivado;
          const beneficios = pricing.beneficios.join('\n');
          await safeSendText(client, telefono,
            `🔥 *PLAN GYMBRO MOTIVAD@ - SEDE ${currentLocation.toUpperCase()} - ${pricing.mensual},000/mes* 🔥\n\n` +
            beneficios + '\n\n' +
            'Escribe "contratar" para proceder\n' +
            'Escribe "menu" para volver al menú principal'
          );
        } else {
          await safeSendText(client, telefono, '❓ Esta membresía no está disponible en la sede Venecia.\n\nEscribe "2" para ver los planes disponibles en esta sede.');
        }

      } else if (text.includes('firme')) {
        if (currentLocation === '20 de Julio') {
          userStates[telefono].selectedPlan = 'firme';
          const pricing = locationPricing[currentLocation].firme;
          const beneficios = pricing.beneficios.join('\n');
          await safeSendText(client, telefono,
            `⚡ *MEMBRESÍA BIMESTRE FIRME - SEDE ${currentLocation.toUpperCase()} - ${pricing.mensual},000* ⚡\n\n` +
            beneficios + '\n\n' +
            'Escribe "contratar" para proceder\n' +
            'Escribe "menu" para volver al menú principal'
          );
        } else {
          await safeSendText(client, telefono, '❓ Esta membresía no está disponible en la sede Venecia.\n\nEscribe "2" para ver los planes disponibles.');
        }

      } else if (text.includes('disciplinado')) {
        if (currentLocation === '20 de Julio') {
          userStates[telefono].selectedPlan = 'disciplinado';
          const pricing = locationPricing[currentLocation].disciplinado;
          const beneficios = pricing.beneficios.join('\n');
          await safeSendText(client, telefono,
            `🏋️ *MEMBRESÍA TRIMESTRE DISCIPLINAD@ - SEDE ${currentLocation.toUpperCase()} - ${pricing.mensual},000* 🏋️\n\n` +
            beneficios + '\n\n' +
            'Escribe "contratar" para proceder\n' +
            'Escribe "menu" para volver al menú principal'
          );
        } else {
          await safeSendText(client, telefono, '❓ Esta membresía no está disponible en la sede Venecia.\n\nEscribe "2" para ver los planes disponibles.');
        }

      } else if (text.includes('superfitt') || text.includes('superfit')) {
        if (currentLocation === '20 de Julio') {
          userStates[telefono].selectedPlan = 'superfitt';
          const pricing = locationPricing[currentLocation].superfitt;
          const beneficios = pricing.beneficios.join('\n');
          await safeSendText(client, telefono,
            `🥇 *MEMBRESÍA SEMESTRE SUPER FITT - SEDE ${currentLocation.toUpperCase()} - ${pricing.mensual},000* 🥇\n\n` +
            beneficios + '\n\n' +
            'Escribe "contratar" para proceder\n' +
            'Escribe "menu" para volver al menú principal'
          );
        } else {
          await safeSendText(client, telefono, '❓ Esta membresía no está disponible en la sede Venecia.\n\nEscribe "2" para ver los planes disponibles.');
        }

      } else if (text.includes('pro')) {
        if (currentLocation === '20 de Julio') {
          userStates[telefono].selectedPlan = 'pro';
          const pricing = locationPricing[currentLocation].pro;
          const beneficios = pricing.beneficios.join('\n');
          await safeSendText(client, telefono,
            `👑 *MEMBRESÍA ANUALIDAD PRO - SEDE ${currentLocation.toUpperCase()} - ${pricing.mensual},000* 👑\n\n` +
            beneficios + '\n\n' +
            'Escribe "contratar" para proceder\n' +
            'Escribe "menu" para volver al menú principal'
          );
        } else {
          await safeSendText(client, telefono, '❓ Esta membresía no está disponible en la sede Venecia.\n\nEscribe "2" para ver los planes disponibles.');
        }

      } else if (text.includes('flash')) {
        if (currentLocation === 'Venecia') {
          userStates[telefono].selectedPlan = 'flash';
          const pricing = locationPricing[currentLocation].flash;
          const beneficios = pricing.beneficios.join('\n');
          await safeSendText(client, telefono,
            `⚡ *PLAN GYMBRO FLASH - SEDE ${currentLocation.toUpperCase()} - ${pricing.mensual},000/mes* ⚡\n\n` +
            beneficios + '\n\n' +
            'Escribe "contratar" para proceder\n' +
            'Escribe "menu" para volver al menú principal'
          );
        } else {
          await safeSendText(client, telefono, '❓ Este plan no está disponible en la sede 20 de Julio.\n\nEscribe "2" para ver las membresías disponibles.');
        }

      } else if (text.includes('class')) {
        if (currentLocation === 'Venecia') {
          userStates[telefono].selectedPlan = 'class';
          const pricing = locationPricing[currentLocation].class;
          const beneficios = pricing.beneficios.join('\n');
          await safeSendText(client, telefono,
            `🎓 *PLAN GYMBRO CLASS - SEDE ${currentLocation.toUpperCase()} - ${pricing.mensual},000/mes* 🎓\n\n` +
            beneficios + '\n\n' +
            'Escribe "contratar" para proceder\n' +
            'Escribe "menu" para volver al menú principal'
          );
        } else {
          await safeSendText(client, telefono, '❓ Este plan no está disponible en la sede 20 de Julio.\n\nEscribe "2" para ver las membresías disponibles.');
        }

      } else if (text.includes('elite')) {
        if (currentLocation === 'Venecia') {
          userStates[telefono].selectedPlan = 'elite';
          const pricing = locationPricing[currentLocation].elite;
          const beneficios = pricing.beneficios.join('\n');
          await safeSendText(client, telefono,
            `🎖 *PLAN GYMBRO ELITE - SEDE ${currentLocation.toUpperCase()} - ${pricing.mensual},000/mes* 🎖\n\n` +
            beneficios + '\n\n' +
            'Escribe "contratar" para proceder\n' +
            'Escribe "menu" para volver al menú principal'
          );
        } else {
          await safeSendText(client, telefono, '❓ Este plan no está disponible en la sede 20 de Julio.\n\nEscribe "2" para ver las membresías disponibles.');
        }

      } else if (text.includes('bro') && !text.includes('trimestre') && !text.includes('semestre')) {
        if (currentLocation === 'Venecia') {
          userStates[telefono].selectedPlan = 'bro';
          const pricing = locationPricing[currentLocation].bro;
          const beneficios = pricing.beneficios.join('\n');
          await safeSendText(client, telefono,
            `👥 *PLAN ENTRENA CON TU BRO - SEDE ${currentLocation.toUpperCase()} - ${pricing.mensual},000/mes* 👥\n\n` +
            beneficios + '\n\n' +
            'Escribe "contratar" para proceder\n' +
            'Escribe "menu" para volver al menú principal'
          );
        } else {
          await safeSendText(client, telefono, '❓ Este plan no está disponible en la sede 20 de Julio.\n\nEscribe "2" para ver las membresías disponibles.');
        }

      } else if (text.includes('trimestre')) {
        if (currentLocation === 'Venecia') {
          userStates[telefono].selectedPlan = 'trimestre';
          const pricing = locationPricing[currentLocation].trimestre;
          const beneficios = pricing.beneficios.join('\n');
          await safeSendText(client, telefono,
            `🔄 *PLAN BRO TRIMESTRE - SEDE ${currentLocation.toUpperCase()} - ${pricing.precio},000* 🔄\n\n` +
            beneficios + '\n\n' +
            'Escribe "contratar" para proceder\n' +
            'Escribe "menu" para volver al menú principal'
          );
        } else {
          await safeSendText(client, telefono, '❓ Este plan no está disponible en la sede 20 de Julio.\n\nEscribe "2" para ver las membresías disponibles.');
        }

      } else if (text.includes('semestre')) {
        if (currentLocation === 'Venecia') {
          userStates[telefono].selectedPlan = 'semestre';
          const pricing = locationPricing[currentLocation].semestre;
          const beneficios = pricing.beneficios.join('\n');
          await safeSendText(client, telefono,
            `📆 *PLAN SEMESTRE BRO - SEDE ${currentLocation.toUpperCase()} - ${pricing.precio},000* 📆\n\n` +
            beneficios + '\n\n' +
            'Escribe "contratar" para proceder\n' +
            'Escribe "menu" para volver al menú principal'
          );
        } else {
          await safeSendText(client, telefono, '❓ Este plan no está disponible en la sede 20 de Julio.\n\nEscribe "2" para ver las membresías disponibles.');
        }

      } else if (text.includes('contratar') || userStates[telefono].contratarState === 'waitingForPaymentMethod') {
        const planSolicitado = text.split('contratar')[1]?.trim();
        
        if (planSolicitado && userStates[telefono].contratarState === 'initial') {
          userStates[telefono].selectedPlan = planSolicitado;
        }
        
        if (userStates[telefono].selectedPlan && userStates[telefono].contratarState === 'initial') {
          userStates[telefono].contratarState = 'waitingForPaymentMethod';
          await safeSendText(client, telefono,
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
            await safeSendText(client, telefono, '❌ Opción de pago inválida. Por favor, selecciona una opción válida.');
            userStates[telefono].contratarState = 'waitingForPaymentMethod';
            await safeSendText(client, telefono,
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
            await safeSendText(client, telefono, '✅ Gracias, recibimos tu cédula.');
            await safeSendText(client, telefono, '🔄 Te estamos transfiriendo con uno de nuestros asesores, espera un momento en línea.');
          }
          
          if (metodoPago === 'transferencia') {
            let qrBase64;
            if (currentLocation === 'Venecia') {
              qrBase64 = await imageToBase64('./qr_venecia.jpg');
            } else if (currentLocation === '20 de Julio') {
              qrBase64 = await imageToBase64('./qr_20dejulio.jpg');
            }
            
            if (qrBase64) {
              await sendQRCode(client, telefono, qrBase64);
              await safeSendText(client, telefono, 'Después de realizar tu pago, si eres cliente nuevo, realiza tu inscripción aquí: Registro GYMBRO 👉 https://aplicacion.gymbrocolombia.com/registro/add');
            } else {
              await safeSendText(client, telefono, '❌ No se pudo cargar el QR. Por favor, intenta de nuevo.');
            }
          } else if (metodoPago === 'addi') {
            esperandoCedula = true;
            await safeSendText(client, telefono, '👉 Para pagar con Addi: requiero tu cédula y te llegará un link a tu celular');
            await safeSendText(client, telefono, 'Recuerda enviarnos el comprobante después de realizar tu pago. Si eres cliente nuevo, realiza tu inscripción aquí: Registro GYMBRO 👉 https://aplicacion.gymbrocolombia.com/registro/add');
          } else if (metodoPago === 'tarjeta') {
            await safeSendText(client, telefono, `💳 Para pagar con tarjeta, por favor dirígete a la recepción de la sede *${currentLocation}*.`);
          } else if (metodoPago === 'efectivo') {
            await safeSendText(client, telefono, `💰 Para pagar en *Efectivo*, por favor dirígete a la recepción de la sede *${currentLocation}*.`);
          } else if (metodoPago === 'pse') {
            await safeSendText(client, telefono, '👉 Sigue este enlace para pagar con PSE: https://checkout.wompi.co/l/VPOS_tTb23T');
            await safeSendText(client, telefono, 'Recuerda enviarnos el comprobante después de realizar tu pago, si eres cliente nuevo, realiza tu inscripción aquí: Registro GYMBRO 👉 https://aplicacion.gymbrocolombia.com/registro/add');
          }
          
          userStates[telefono].selectedPlan = null;
        } else {
          await safeSendText(client, telefono, '❓ No pudimos identificar el plan que deseas contratar.\n\nEscribe "2" para volver a ver nuestras membresías.');
        }
        
      } else if (text === 'menu' || text === '0' || text === 'menú') {
        if (currentLocation === '20 de Julio') {
          await safeSendText(client, telefono,
            '🏋️‍♂️ *MENÚ PRINCIPAL - SEDE 20 DE JULIO* 🏋️‍♀️\n\n' +
            'Escribe el número de tu opción:\n\n' +
            '1️⃣ Información sobre nuestro gimnasio\n' +
            '2️⃣ Membresías y tarifas\n' +
            '3️⃣ Sedes y horarios\n' +
            '4️⃣ Horarios clases grupales\n' +
            '5️⃣ Trabaja con nosotros\n' +
            '0️⃣ Volver al inicio'
          );
        } else {
          await safeSendText(client, telefono,
            '🏋️‍♂️ *MENÚ PRINCIPAL - SEDE VENECIA* 🏋️‍♀️\n\n' +
            'Escribe el número de tu opción:\n\n' +
            '1️⃣ Información sobre nuestro gimnasio\n' +
            '2️⃣ Membresías y tarifas\n' +
            '3️⃣ Sedes y horarios\n' +
            '4️⃣ Horarios clases grupales\n' +
            '5️⃣ Trabaja con nosotros\n' +
            '0️⃣ Volver al inicio'
          );
        }
        
      } else if (text === '3' || text.includes('sede') || text.includes('horario')) {
        await safeSendText(client, telefono,
          '📍 *Horarios y Sedes GYMBRO* 🕒\n\n' +
          '*Sede 20 de Julio*\n' +
          '📍 Dirección: Cra. 5a #32 21 Sur\n' +
          '🕐 Horario: Lunes a viernes 5am - 10pm / Sábados 7am - 5pm / Domingos 8am - 4pm\n\n' +
          '*Sede Venecia*\n' +
          '📍 Dirección: Tv. 44 #51b 30 Sur\n' +
          '🕐 Horario: Lunes a viernes 5am - 10pm / Sábados 7am - 5pm / Domingos 8am - 4pm\n\n' +
          'Escribe "menu" para volver al menú principal.'
        );
        
      } else if (text === '4') {
        await safeSendText(client, telefono,
          '📅 *Horarios de Clases Grupales*\n\n' +
          '🕐 Lunes a Viernes:\n' +
          '🟢 *7:00 a.m.*\n' +
          '🟢 *7:00 p.m.*\n\n' +
          '💪 Te esperamos para entrenar juntos y mantener la energía al 100%.\n\n' +
          'Escribe *"menu"* para regresar al menú principal.'
        );
        
      } else if (text === '5') {
        await safeSendText(client, telefono,
          '🙌 ¡Qué alegría que quieras hacer parte de nuestra familia GYMBRO!\n\n' +
          '📄 Si estás interesado en trabajar con nosotros, envíanos tu hoja de vida al siguiente número de WhatsApp: +57 318 6196126.\n\n' +
          'Te contactaremos si hay una vacante que se ajuste a tu perfil.\n\n' +
          'Escribe *"menu"* para regresar al menú principal.'
        );
        
      } else if (text.includes('permanencia') || text.includes('atadura') || text.includes('amarrado')) {
        await safeSendText(client, telefono,
          '💪 ¡En GYMBRO no tenemos ninguna atadura! Puedes cancelar tu membresía cuando lo desees. Queremos que te quedes porque amas entrenar, no por obligación.\n\n' +
          'Escribe "menu" para volver al menú principal o consulta alguna otra opción.'
        );
        
      } else if (text.includes('asesor')) {
        userStates[telefono].redirigiendoAsesor = true;
        await safeSendText(client, telefono,
          '💬 Te estoy redirigiendo a un asesor. Por favor, espera en línea. Un asesor humano continuará la conversación contigo.'
        );
        return;
        
      } else if (text.includes('inscripcion') || text.includes('inscripción') || text.includes('registro')) {
        await safeSendText(client, telefono,
          '💪 ¡En GYMBRO no cobramos inscripción! Queremos que hagas parte de nuestra familia fitness. Puedes adquirir tu membresía cuando lo desees o acercarte a conocer nuestras instalaciones sin compromiso. ¡Te esperamos!\n\n' +
          'Realiza tu inscripción aquí: Registro GYMBRO 👉 https://aplicacion.gymbrocolombia.com/registro/add\n\n' +
          'Escribe "menu" para volver al menú principal.'
        );
        
      } else {
        await safeSendText(client, telefono,
          '🤖 No entendí tu mensaje. Por favor selecciona una opción válida o escribe "menu" para volver al inicio.\n\n' +
          'Comandos disponibles:\n' +
          '• "menu" - Menú principal\n' +
          '• "asesor" - Hablar con humano\n' +
          '• "salir" - Finalizar chat\n' 
        );
      }
      
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
        console.error('❌ Error guardando en BD:', dbError);
      }
      
    } catch (error) {
      console.error('❌ Error al procesar mensaje:', error);
      await safeSendText(client, telefono, '⚠️ Ocurrió un error al procesar tu mensaje. Intenta de nuevo.');
    }
  });

  // Manejar eventos de desconexión
  client.onStateChange((state) => {
    console.log('📱 Estado del cliente:', state);
    if (state === 'CONNECTED') {
      clientReady = true;
      reconnectAttempts = 0;
    } else if (state === 'DISCONNECTED') {
      clientReady = false;
      console.log('⚠️ Cliente desconectado');
      scheduleReconnect();
    }
  });
}

// Función principal de inicialización del bot
async function initializeBot() {
  try {
    // Obtener ruta de Chromium
    const chromiumPath = findPuppeteerChrome();
    
    const client = await venom.create(
      'gymbro-session',
      (base64Qr, asciiQR) => {
        console.log('📱 Escanea este QR:');
        console.log(asciiQR);
      },
      (statusSession) => {
        console.log('📱 Estado:', statusSession);
        if (statusSession === 'successChat' || statusSession === 'chatsAvailable') {
          clientReady = true;
          reconnectAttempts = 0; // Reset counter on success
          console.log('✅ Bot completamente listo!');
        }
        
        // Detectar desconexión
        if (statusSession === 'notLogged' || statusSession === 'browserClose') {
          console.log('⚠️ Bot desconectado, intentando reconectar...');
          clientReady = false;
          scheduleReconnect();
        }
      },
      {
        multidevice: true,
        folderNameToken: 'tokens',
        headless: 'new',
        logQR: true,
        
        // Usar el Chromium específico de Puppeteer si está disponible
        ...(chromiumPath && { browserPathExecutable: chromiumPath }),
        
       browserArgs: [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-web-security',
  '--disable-features=VizDisplayCompositor',
  '--disable-gpu',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-default-apps',
  '--single-process',      // ← Agregar esta línea
  '--no-zygote'           // ← Agregar esta línea
],
        
        // Configuraciones adicionales para estabilidad
        useChrome: !chromiumPath, // Usar Chrome del sistema solo si no hay Chromium
        debug: false,
        refreshQR: 15000, // Refrescar QR cada 15 segundos
        autoClose: 0, // No cerrar automáticamente
        disableSpins: true,
        disableWelcome: true,
        
        // Timeouts más largos
        timeout: 60000,
        
        // Configuración específica de Puppeteer
        ...(chromiumPath && {
          puppeteerOptions: {
            executablePath: chromiumPath,
            headless: 'new',
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-web-security',
              '--disable-features=VizDisplayCompositor'
            ]
          }
        })
      }
    );

    globalClient = client;
    
    console.log('✅ GYMBRO Bot conectado!');
    
    // Verificar BD al inicio
    await testDatabaseConnection();
    
    // Configurar manejo de mensajes
    console.log('🎯 Configurando manejo de mensajes...');
    setupMessageHandlers(client);
    
    // Ping periódico para mantener conexión
    setInterval(async () => {
      try {
        if (clientReady && globalClient) {
          await globalClient.getHostDevice();
        }
      } catch (error) {
        console.log('⚠️ Error en ping, posible desconexión');
        scheduleReconnect();
      }
    }, 60000); // Cada minuto

    // Verificar usuarios inactivos cada hora
    setInterval(() => {
      if (clientReady && globalClient) {
        checkInactiveUsers(globalClient);
      }
    }, 60 * 60 * 1000);
    
    // Limpiar estados inactivos (mejorado)
    setInterval(async () => {
      if (clientReady && globalClient) {
        await cleanupInactiveUsers(globalClient);
      } else {
        console.log('⚠️ Saltando limpieza - Bot no está listo');
      }
    }, CLEANUP_INTERVAL);

    // Mostrar estadísticas cada 5 minutos
    setInterval(() => {
      if (Object.keys(userStates).length > 0) {
        showUserStats();
      }
    }, 5 * 60 * 1000);

    return client;
    
  } catch (error) {
    console.error('❌ Error inicializando bot:', error);
    scheduleReconnect();
    throw error;
  }
}

// Monitoreo de memoria
setInterval(() => {
  const used = process.memoryUsage();
  console.log('💾 Memoria:', {
    rss: Math.round(used.rss / 1024 / 1024) + ' MB',
    heapUsed: Math.round(used.heapUsed / 1024 / 1024) + ' MB'
  });
  
  // Si el uso de memoria es muy alto, reiniciar
  if (used.heapUsed > 500 * 1024 * 1024) { // 500MB
    console.log('⚠️ Uso de memoria alto, reiniciando...');
    process.exit(1);
  }
}, 300000); // Cada 5 minutos

// Inicializar el bot
console.log('🚀 Iniciando GYMBRO Bot con mejoras de estabilidad...');
initializeBot().catch((error) => {
  console.error('❌ Fallo crítico:', error);
  process.exit(1);
});