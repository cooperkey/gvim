#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_PY="$SCRIPT_DIR/host.py"
HOST_NAME="com.vimfordocs.neovim"
CHROME_EXT_ID="${1:-eehdcoloojhmdcpeaplimdebfbmalind}"
FIREFOX_EXT_ID="greenstorm@vimfordocs.org"

chmod +x "$HOST_PY"

echo "==========================================="
echo " Installing Vim-For-Docs Native Host"
echo "==========================================="
echo "Target host script: $HOST_PY"
echo "Allowed Chrome Extension ID: $CHROME_EXT_ID"

# Chrome-based browsers manifest
create_chrome_manifest() {
  local target_dir="$1"
  local manifest_file="$target_dir/$HOST_NAME.json"
  mkdir -p "$target_dir" 2>/dev/null || return 0
  cat > "$manifest_file" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Vim for Docs Native Neovim Host",
  "path": "$HOST_PY",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://eehdcoloojhmdcpeaplimdebfbmalind/",
    "chrome-extension://$CHROME_EXT_ID/"
  ]
}
EOF
  echo " Installed Chrome manifest: $manifest_file"
}

# Firefox manifest
create_firefox_manifest() {
  local target_dir="$1"
  local manifest_file="$target_dir/$HOST_NAME.json"
  mkdir -p "$target_dir"
  cat > "$manifest_file" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Vim for Docs Native Neovim Host",
  "path": "$HOST_PY",
  "type": "stdio",
  "allowed_extensions": [
    "$FIREFOX_EXT_ID"
  ]
}
EOF
  echo " Installed Firefox manifest: $manifest_file"
}

# macOS paths
if [[ "$OSTYPE" == "darwin"* ]]; then
  # Google Chrome & Variants
  create_chrome_manifest "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  create_chrome_manifest "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
  create_chrome_manifest "$HOME/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts"
  create_chrome_manifest "$HOME/Library/Application Support/Google/Chrome Dev/NativeMessagingHosts"
  # Brave Browser
  create_chrome_manifest "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  # Arc Browser
  create_chrome_manifest "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts"
  create_chrome_manifest "$HOME/Library/Application Support/Arc/NativeMessagingHosts"
  # Microsoft Edge
  create_chrome_manifest "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
  # Chromium
  create_chrome_manifest "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
  # Firefox
  create_firefox_manifest "$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
else
  # Linux paths
  create_chrome_manifest "$HOME/.config/google-chrome/NativeMessagingHosts"
  create_chrome_manifest "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  create_chrome_manifest "$HOME/.config/microsoft-edge/NativeMessagingHosts"
  create_chrome_manifest "$HOME/.config/chromium/NativeMessagingHosts"
  create_firefox_manifest "$HOME/.mozilla/native-messaging-hosts"
fi

echo ""
echo "✅ Vim-For-Docs Native Messaging Host installed successfully!"
echo "   Neovim will automatically connect when Google Docs is opened."
