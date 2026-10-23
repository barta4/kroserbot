require('dotenv').config();
const { executeTool } = require('../services/webhook/toolExecutor');
const traductorTecnico = require('../utils/traductorTecnico');
const db = require('../config/db');

async function main() {
  console.log('========================================================================');
  console.log('DEMO EN VIVO: ARQUITECTURA DE 3 ROLES (EQUIPO DE MOSTRADOR KROSER)');
  console.log('========================================================================\n');

  const mensajeCliente = 'Hola che vendeme un cortador de caño pvc para una gotera';
  console.log('👤 [CLIENTE WHATSAPP]:');
  console.log(`"${mensajeCliente}"\n`);

  console.log('------------------------------------------------------------------------');
  console.log('🛠️ 1. EL TRADUCTOR TÉCNICO:');
  const ficha = traductorTecnico.generarFichaTecnica(mensajeCliente);
  console.log('- Mensaje limpio:', `"${ficha.terminos_limpios}"`);
  console.log('- Traducción técnica oficial:', `"${ficha.consulta_tecnica}"`);
  console.log('- Especificaciones detectadas:', JSON.stringify(ficha.especificaciones));
  console.log('- Nota de dato faltante:', `"${ficha.faltante}"\n`);

  console.log('------------------------------------------------------------------------');
  console.log('📦 2. EL ENCARGADO DEL DEPÓSITO (Catálogo PostgreSQL / pgvector):');
  const toolResult = await executeTool('buscar_productos', { consulta: 'cortador de caño pvc' }, { lastUserMessage: mensajeCliente });
  console.log('- Stock confirmado:', toolResult.reporte_deposito?.stock_confirmado);
  console.log('- Total artículos encontrados:', toolResult.total_coincidencias);
  console.log('- Opciones en stock:', toolResult.productos.map(p => `${p.nombre} -> ${p.precio}`));
  console.log('\n------------------------------------------------------------------------');
  console.log('🗣️ 3. DIRECTIVA PARA EL VENDEDOR DEL MOSTRADOR:');
  console.log(`"${toolResult.directiva_vendedor}"\n`);

  console.log('========================================================================');
  console.log('✅ DEMO COMPLETADA EXITOSAMENTE');
  console.log('========================================================================');
  process.exit(0);
}

main().catch(err => {
  console.error('Error en demo:', err);
  process.exit(1);
});
