# HealthVault AI — Deployment Guide

## 1. Target Infrastructure Overview

HealthVault AI is deployed on a dedicated Proxmox VE unprivileged LXC container within the private homelab network.

| Component | Specification |
|---|---|
| **Platform** | Proxmox VE LXC / Debian / Ubuntu / Docker |
| **Hostname** | `healthvault` |
| **vCPU / RAM** | 2 vCPU / 2048 MiB RAM / 1024 MiB Swap |
| **Disk** | 16 GiB SSD |
| **Application Port** | `3000` |
| **Ingress Service**| Cloudflare Tunnel / Reverse Proxy (Nginx, Caddy, Traefik) |

---

## 2. Cloudflare Tunnel / Ingress Setup

To expose HealthVault AI securely to your domain:

1. Open your Cloudflare Zero Trust Dashboard (or Reverse Proxy config).
2. Configure a public hostname routing:
   - **Service Type**: `HTTP`
   - **URL / Origin**: `http://<CONTAINER_IP>:3000`
3. Save hostname. Traffic is routed with TLS termination directly to the application container.

---

## 3. LXC Service Architecture

Within LXC 133, HealthVault AI runs as a managed production service:

```text
/opt/healthvault/
├── .env
├── package.json
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── dist/ (.next build)
└── data/ (PostgreSQL & uploads)
```

### Option A: Native Node.js + PostgreSQL (Production systemd unit)

#### 1. System Packages Installation
```bash
apt-get update && apt-get install -y curl git postgresql postgresql-contrib
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pnpm pm2
```

#### 2. PostgreSQL Configuration
```sql
sudo -u postgres psql
CREATE DATABASE healthvault;
CREATE USER healthvault WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE healthvault TO healthvault;
GRANT ALL ON SCHEMA public TO healthvault;
\q
```

#### 3. Systemd Service Definition (`/etc/systemd/system/healthvault.service`)
```ini
[Unit]
Description=HealthVault AI Web Application
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/healthvault
EnvironmentFile=/opt/healthvault/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=healthvault

[Install]
WantedBy=multi-user.target
```

### Option B: Docker Compose

Alternatively, deploy using the bundled `docker-compose.yml`:
```bash
cd /opt/healthvault
docker compose up -d
```

---

## 4. Healthcheck Verification

HealthVault AI exposes a comprehensive, zero-leak healthcheck endpoint at:
```http
GET http://localhost:3000/api/health
```

Expected Response (`HTTP 200 OK`):
```json
{
  "status": "ok",
  "database": "ok",
  "version": "1.0.0",
  "timestamp": "2026-09-24T14:00:00.000Z"
}
```
