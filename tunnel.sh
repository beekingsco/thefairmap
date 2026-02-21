#!/bin/bash
# Cloudflare Quick Tunnel for TheFairMap (foreground — PM2 manages lifecycle)
TUNNEL_URL_FILE="/Users/scoutbot/.openclaw/workspace/thefairmap/.tunnel-url"

# Run cloudflared in the foreground; capture output to extract URL
cloudflared tunnel --url http://localhost:4000 2>&1 | tee >(
  grep -o 'https://[^ ]*\.trycloudflare\.com' | head -1 > "$TUNNEL_URL_FILE"
) 
