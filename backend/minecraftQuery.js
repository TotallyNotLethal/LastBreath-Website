const net = require('net');

function encodeVarInt(value) {
  const bytes = [];
  let temp = value >>> 0;
  do {
    let byte = temp & 0x7f;
    temp >>>= 7;
    if (temp !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (temp !== 0);
  return Buffer.from(bytes);
}

function decodeVarInt(buffer, offset = 0) {
  let numRead = 0;
  let result = 0;
  let read;

  do {
    if (offset + numRead >= buffer.length) {
      throw new Error('VarInt exceeds buffer length');
    }

    read = buffer[offset + numRead];
    const value = read & 0x7f;
    result |= value << (7 * numRead);

    numRead += 1;
    if (numRead > 5) {
      throw new Error('VarInt is too big');
    }
  } while ((read & 0x80) !== 0);

  return { value: result, bytesRead: numRead };
}

function buildHandshakePacket(host, port) {
  const protocolVersion = 765; // Compatible modern default; server still responds with status.
  const hostBuffer = Buffer.from(host, 'utf8');

  const packetId = encodeVarInt(0x00);
  const protocolBuffer = encodeVarInt(protocolVersion);
  const hostLength = encodeVarInt(hostBuffer.length);
  const portBuffer = Buffer.alloc(2);
  portBuffer.writeUInt16BE(port, 0);
  const nextState = encodeVarInt(0x01);

  const packetData = Buffer.concat([
    packetId,
    protocolBuffer,
    hostLength,
    hostBuffer,
    portBuffer,
    nextState
  ]);

  return Buffer.concat([encodeVarInt(packetData.length), packetData]);
}

function buildStatusRequestPacket() {
  const packetData = Buffer.from([0x00]);
  return Buffer.concat([encodeVarInt(packetData.length), packetData]);
}

function parseStatusResponse(data) {
  const { value: packetLength, bytesRead: packetLengthBytes } = decodeVarInt(data, 0);
  if (data.length < packetLengthBytes + packetLength) {
    throw new Error('Incomplete packet received from server');
  }

  const { value: packetId, bytesRead: packetIdBytes } = decodeVarInt(data, packetLengthBytes);
  if (packetId !== 0x00) {
    throw new Error(`Unexpected packet id ${packetId}`);
  }

  const stringLengthInfo = decodeVarInt(data, packetLengthBytes + packetIdBytes);
  const stringStart = packetLengthBytes + packetIdBytes + stringLengthInfo.bytesRead;
  const stringEnd = stringStart + stringLengthInfo.value;

  const jsonString = data.slice(stringStart, stringEnd).toString('utf8');
  return JSON.parse(jsonString);
}

async function queryJavaServerStatus(host = 'mc.lastbreath.net', port = 25565, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const start = Date.now();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (_err) {}
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      socket.write(buildHandshakePacket(host, port));
      socket.write(buildStatusRequestPacket());
    });

    socket.once('data', (data) => {
      try {
        const parsed = parseStatusResponse(data);
        const sample = Array.isArray(parsed?.players?.sample) ? parsed.players.sample : [];
        finish({
          online: true,
          host,
          port,
          latency_ms: Date.now() - start,
          version: parsed?.version?.name || 'Unknown',
          protocol: parsed?.version?.protocol ?? null,
          online_players: parsed?.players?.online ?? 0,
          max_players: parsed?.players?.max ?? 0,
          players_online: sample.map((player) => player.name).filter(Boolean),
          motd: parsed?.description,
          favicon: parsed?.favicon || null,
          queried_at: new Date().toISOString()
        });
      } catch (error) {
        finish({
          online: false,
          host,
          port,
          error: `Failed to parse Minecraft status response: ${error.message}`,
          queried_at: new Date().toISOString()
        });
      }
    });

    socket.once('timeout', () => {
      finish({
        online: false,
        host,
        port,
        error: `Minecraft status query timeout after ${timeoutMs}ms`,
        queried_at: new Date().toISOString()
      });
    });

    socket.once('error', (error) => {
      finish({
        online: false,
        host,
        port,
        error: `Minecraft status query failed: ${error.message}`,
        queried_at: new Date().toISOString()
      });
    });

    socket.connect(port, host);
  });
}

module.exports = { queryJavaServerStatus };
