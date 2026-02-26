#!/bin/bash
# Setup script for Xvfb virtual display

echo "🖥️  Starting Xvfb virtual display..."

# Start Xvfb on display :99 with resolution 1920x1080x24
Xvfb :99 -screen 0 1920x1080x24 &
XVFB_PID=$!

echo "   Xvfb started with PID: $XVFB_PID"
echo "   Display: :99"

# Export DISPLAY variable
export DISPLAY=:99

# Test that X server is running
sleep 2
if xdpyinfo -display :99 >/dev/null 2>&1; then
    echo "   ✅ X11 display ready!"
else
    echo "   ❌ X11 display failed to start"
    exit 1
fi

echo ""
echo "To use Playwright with Xvfb, run:"
echo "  export DISPLAY=:99"
echo "  npx tsx your-script.ts"
echo ""
echo "PID file: /tmp/xvfb.pid"
echo $XVFB_PID > /tmp/xvfb.pid
