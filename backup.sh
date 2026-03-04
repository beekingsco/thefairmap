#!/bin/bash
BACKUP_BASE="/Users/scoutbot/.openclaw/workspace/thefairmap-backups"
BACKUP_DIR="$BACKUP_BASE/$(date +%Y-%m-%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r /Users/scoutbot/.openclaw/workspace/thefairmap/data "$BACKUP_DIR/"
echo "Backup saved to $BACKUP_DIR"
ls -dt "$BACKUP_BASE"/20* 2>/dev/null | tail -n +31 | xargs rm -rf 2>/dev/null
echo "Old backups pruned"
