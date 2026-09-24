# HealthVault AI — Backup and Disaster Recovery Strategy

## 1. Overview & RPO/RTO Targets

Health records, versioned clinical recommendations, and conversation archives must have continuous protection against hardware failures, disk corruption, and operator errors.

- **Recovery Point Objective (RPO)**: <= 24 hours (nightly automated snapshots and pg_dump).
- **Recovery Time Objective (RTO)**: <= 30 minutes (full container restore from Proxmox vzdump) or <= 5 minutes (PostgreSQL logical restore).

---

## 2. Backup Layers

### Layer 1: PostgreSQL Logical Dump (`pg_dump`)
Captures all relational tables, message versions, recommendation histories, dosage updates, and audit logs.

#### Automated Cron Script (`/opt/healthvault/scripts/backup-db.sh`)
```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/healthvault"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/healthvault_${DATE}.sql.gz"

mkdir -p "${BACKUP_DIR}"

# Dump database compressed with gzip
PGPASSWORD="${DB_PASSWORD:-healthvault_secret}" pg_dump -U healthvault -h 127.0.0.1 -d healthvault | gzip > "${BACKUP_FILE}"

# Retain backups for 30 days
find "${BACKUP_DIR}" -name "healthvault_*.sql.gz" -type f -mtime +30 -delete

echo "Backup created at ${BACKUP_FILE}"
```

### Layer 2: File Attachments & Uploads
Clinical PDFs, lab reports, and image attachments located at `/opt/healthvault/uploads` are synchronized daily to NAS storage or backed up via tarball:
```bash
tar -czf "/var/backups/healthvault/uploads_${DATE}.tar.gz" -C /opt/healthvault uploads
```

### Layer 3: Proxmox Host-Level Snapshot (`vzdump`)
The entire LXC 133 container is snapshotted to Proxmox backup storage (`NAS_Mirror_Containers` or local storage) using Zstandard compression.

```bash
# Executed on Proxmox host (homeLAB)
vzdump 133 --mode snapshot --compress zstd --storage NAS_Mirror_Containers --mailnotification failure
```

---

## 3. Disaster Recovery & Restore Procedures

### Restoring Database from SQL Dump
1. Stop the application service to prevent in-flight writes:
   ```bash
   systemctl stop healthvault
   ```
2. Drop and recreate the database:
   ```bash
   sudo -u postgres psql -c "DROP DATABASE IF EXISTS healthvault;"
   sudo -u postgres psql -c "CREATE DATABASE healthvault OWNER healthvault;"
   ```
3. Restore database schema and data:
   ```bash
   gunzip -c /var/backups/healthvault/healthvault_20260924_XXXXXX.sql.gz | psql -U healthvault -h 127.0.0.1 -d healthvault
   ```
4. Run Prisma database sanity check:
   ```bash
   npx prisma migrate status
   ```
5. Restart application service:
   ```bash
   systemctl start healthvault
   ```

### Restoring Entire LXC 133 from Proxmox Backup
If the LXC filesystem is damaged or the host needs rebuilding:
```bash
# On Proxmox host
pct restore 133 /mnt/pve/NAS_Mirror_Containers/dump/vzdump-lxc-133-*.tar.zst --storage SSD-Storage-2
pct start 133
```

---

## 4. Verification & Integrity Checks

1. Verify record count and version continuity:
   ```sql
   SELECT count(*) FROM conversations;
   SELECT count(*) FROM messages;
   SELECT count(*) FROM medication_versions;
   SELECT count(*) FROM recommendation_versions;
   ```
2. Verify system healthcheck:
   ```bash
   curl -I http://localhost:3000/api/health
   ```
