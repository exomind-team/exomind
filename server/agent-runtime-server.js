#!/usr/bin/env bun

/**
 * Agent Runtime Server（Agent 运行时服务）
 * Minimal local runtime service for Desktop probe/start integration.
 * 桌面端最小运行时服务：用于探测与启停联调。
 */

import { createServer } from 'node:http';

function parseArg(flag, fallbackValue) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallbackValue;
  return process.argv[index + 1] ?? fallbackValue;
}

const host = parseArg('--host', '127.0.0.1');
const portRaw = parseArg('--port', '4077');
const port = Number.parseInt(portRaw, 10);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`[agent-runtime] invalid port: ${portRaw}`);
  process.exit(1);
}

const startedAt = new Date().toISOString();
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
};

const server = createServer((request, response) => {
  const { url = '/' } = request;

  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS_HEADERS);
    response.end();
    return;
  }

  if (url === '/health') {
    const payload = {
      status: 'ok',
      host,
      port,
      startedAt,
      service: 'agent-runtime',
    };
    response.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    response.end(JSON.stringify(payload));
    return;
  }

  if (url === '/runtime/status') {
    const payload = {
      running: true,
      host,
      port,
      startedAt,
      pid: process.pid,
    };
    response.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    response.end(JSON.stringify(payload));
    return;
  }

  response.writeHead(404, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  response.end(JSON.stringify({ error: 'not_found', path: url }));
});

server.listen(port, host, () => {
  console.log(`[agent-runtime] listening on http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
