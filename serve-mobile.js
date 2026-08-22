#!/usr/bin/env node
// Temporary local web server so a phone on the same WiFi can load (and optionally download,
// for fully offline play afterward) the built game. Rebuilds dist/index.html first so it's
// always serving the latest src/ changes. Pure Node core modules only, no dependencies.
"use strict";
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PORT = Number(process.argv[2]) || 5173;
const DIST_FILE = path.join(__dirname, 'dist', 'index.html');

console.log('Building dist/index.html from src/ ...');
execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit' });

function localIPs(){
  const ifaces = os.networkInterfaces();
  const ips = [];
  for(const name of Object.keys(ifaces)){
    for(const iface of ifaces[name]){
      if(iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

const server = http.createServer((req, res) => {
  const html = fs.readFileSync(DIST_FILE); // re-read each request, so re-running `node build.js` in another terminal is picked up without restarting this server
  if(req.url === '/download'){
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="risk-domination.html"',
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  }
  res.end(html);
});

server.listen(PORT, () => {
  const ips = localIPs();
  console.log('\nServer đang chạy. Trên điện thoại (cùng WiFi với máy này):\n');
  ips.forEach(ip => {
    console.log(`  Chơi ngay trong trình duyệt:      http://${ip}:${PORT}/`);
    console.log(`  Tải file về máy để chơi offline:  http://${ip}:${PORT}/download\n`);
  });
  if(ips.length === 0) console.log('  (Không tìm thấy IP mạng LAN nào — kiểm tra đã bật WiFi chưa.)');
  console.log('Nhấn Ctrl+C để tắt server.');
});
