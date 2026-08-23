/**
 * test-mercadopago-security.js
 * 
 * Test suite to validate MercadoPago Webhook HMAC SHA256 Signature Verification.
 */

const crypto = require('crypto');
const validateMercadopagoSignature = require('./middleware/validateMercadopagoSignature');

console.log('[MercadoPago Security Test] Starting validation of HMAC signature middleware...');

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✓ ${message}`);
      passed++;
    } else {
      console.error(`❌ ${message}`);
      failed++;
    }
  }

  // --- Test 1: Missing x-signature header when secret is set ---
  process.env.MERCADOPAGO_WEBHOOK_SECRET = 'my_test_secret_key_123';
  process.env.NODE_ENV = 'production';

  const mockReq1 = {
    headers: {},
    body: { data: { id: '123456' } },
  };

  let statusCode1 = 200;
  let jsonRes1 = {};

  const mockRes1 = {
    status(code) {
      statusCode1 = code;
      return this;
    },
    json(data) {
      jsonRes1 = data;
      return this;
    },
  };

  await validateMercadopagoSignature(mockReq1, mockRes1, () => {});
  assert(statusCode1 === 401, 'Rejects webhook missing x-signature header with 401');

  // --- Test 2: Invalid signature match ---
  const currentTs = Math.floor(Date.now() / 1000).toString();
  const mockReq2 = {
    headers: {
      'x-signature': `ts=${currentTs},v1=invalid_hmac_hash_value`,
      'x-request-id': 'req-999',
    },
    body: { data: { id: '123456' } },
  };

  let statusCode2 = 200;
  const mockRes2 = {
    status(code) {
      statusCode2 = code;
      return this;
    },
    json(data) {
      return this;
    },
  };
  await validateMercadopagoSignature(mockReq2, mockRes2, () => {});
  assert(statusCode2 === 401, 'Rejects webhook with invalid HMAC signature with 401');

  // --- Test 3: Valid HMAC signature match ---
  const secret = 'my_test_secret_key_123';
  const ts = Math.floor(Date.now() / 1000).toString();
  const requestId = 'req-1001';
  const dataId = '987654';
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const validHmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  const mockReq3 = {
    headers: {
      'x-signature': `ts=${ts},v1=${validHmac}`,
      'x-request-id': requestId,
    },
    body: { data: { id: dataId } },
  };

  let nextCalled = false;
  let statusCode3 = 200;

  const mockRes3 = {
    status(code) {
      statusCode3 = code;
      return this;
    },
    json(data) {
      return this;
    },
  };

  await validateMercadopagoSignature(mockReq3, mockRes3, () => {
    nextCalled = true;
  });

  assert(nextCalled && statusCode3 === 200, 'Accepts valid MercadoPago HMAC signature');

  console.log('\n======================================================');
  if (failed === 0) {
    console.log(`ALL ${passed} MERCADOPAGO SECURITY TESTS PASSED!`);
    console.log('======================================================');
    process.exit(0);
  } else {
    console.error(`FAILED ${failed} OF ${passed + failed} TESTS!`);
    console.log('======================================================');
    process.exit(1);
  }
}

runTests();
