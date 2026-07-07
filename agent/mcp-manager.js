const { spawn } = require('child_process');
const path = require('path');
const tools = require('./tools');

const connections = new Map();

function createTransport(config) {
  if (config.type === 'stdio') {
    const cmd = config.command.split(' ')[0];
    const args = config.command.split(' ').slice(1).concat(config.args || []);
    const proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let buf = '';
    let pendingResolve = null;
    let msgId = 0;

    proc.stdout.on('data', (data) => {
      buf += data.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (pendingResolve && msg.id === pendingResolve.id) {
            pendingResolve.resolve(msg);
            pendingResolve = null;
          }
        } catch {}
      }
    });

    proc.stderr.on('data', (data) => {
      console.warn(`[MCP:${config.name}] stderr:`, data.toString());
    });

    proc.on('exit', (code) => {
      console.warn(`[MCP:${config.name}] exited with code ${code}`);
      connections.delete(config.name);
      tools.removeTool(`mcp_${config.name}_*`);
    });

    return {
      proc,
      send: (method, params = {}) => {
        return new Promise((resolve, reject) => {
          const id = ++msgId;
          pendingResolve = { id, resolve, reject };
          const req = JSON.stringify({ jsonrpc: '2.0', id, method, params });
          proc.stdin.write(req + '\n');
          setTimeout(() => {
            if (pendingResolve && pendingResolve.id === id) {
              pendingResolve = null;
              reject(new Error('MCP request timeout'));
            }
          }, 10000);
        });
      },
      close: () => {
        proc.kill();
        connections.delete(config.name);
      },
    };
  }

  if (config.type === 'remote') {
    return {
      send: async (method, params = {}) => {
        const resp = await fetch(config.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        return resp.json();
      },
      close: () => {},
    };
  }

  throw new Error(`Unsupported MCP type: ${config.type}`);
}

async function connectServer(config) {
  if (connections.has(config.name)) {
    return { ok: false, error: '服务已连接' };
  }

  try {
    const transport = createTransport(config);

    const initResp = await transport.send('initialize', {
      protocolVersion: '0.1.0',
      capabilities: {},
      clientInfo: { name: 'agent', version: '1.0.0' },
    });

    if (initResp.error) {
      transport.close();
      return { ok: false, error: initResp.error.message };
    }

    transport.send('notifications/initialized', {}).catch(() => {});

    const toolsResp = await transport.send('tools/list');
    if (toolsResp.error) {
      transport.close();
      return { ok: false, error: toolsResp.error.message };
    }

    const mcpTools = toolsResp.result?.tools || [];
    let registered = 0;
    for (const t of mcpTools) {
      const toolName = `mcp_${config.name}_${t.name}`;
      try {
        tools.addTool(toolName, {
          description: t.description || `MCP tool from ${config.name}`,
          parameters: t.inputSchema || { type: 'object', properties: {} },
          execute: async (args) => {
            const resp = await transport.send('tools/call', {
              name: t.name,
              arguments: args,
            });
            if (resp.error) throw new Error(resp.error.message);
            const content = resp.result?.content || [];
            return content.map(c => c.text || JSON.stringify(c)).join('\n');
          },
        });
        registered++;
      } catch (e) {
        console.warn(`[MCP] 注册工具 ${toolName} 失败:`, e.message);
      }
    }

    connections.set(config.name, transport);
    return { ok: true, name: config.name, tools: registered };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function disconnectServer(name) {
  const transport = connections.get(name);
  if (!transport) return { ok: false, error: `MCP 服务 ${name} 未连接` };
  transport.close();
  tools.listTools().filter(t => t.name.startsWith(`mcp_${name}_`)).forEach(t => {
    tools.removeTool(t.name);
  });
  return { ok: true, name };
}

function getConnections() {
  const result = [];
  for (const [name] of connections) {
    result.push({ name, connected: true });
  }
  return result;
}

module.exports = { connectServer, disconnectServer, getConnections };
