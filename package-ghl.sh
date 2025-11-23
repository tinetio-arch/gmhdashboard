#!/bin/bash
# Package GHL integration files for server deployment

echo "================================================"
echo "Creating GHL Integration Deployment Package"
echo "================================================"
echo ""

# Create timestamp
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
PACKAGE_NAME="ghl-integration-${TIMESTAMP}"

echo "Package name: ${PACKAGE_NAME}.tar.gz"
echo ""

# Create package
echo "Packaging files..."

tar -czf "${PACKAGE_NAME}.tar.gz" \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  app/professional/ \
  app/api/admin/ghl/ \
  app/api/cron/sync-ghl/ \
  lib/patientGHLSync.ts \
  lib/patientQueries.ts \
  lib/ghl.ts \
  lib/basePath.ts \
  components/GHLSyncBadge.tsx \
  components/GHLBulkSync.tsx \
  migrations/20251122_add_ghl_sync.sql \
  migrations/20251122_update_patient_views_ghl.sql \
  scripts/run-ghl-migration.js \
  next.config.js \
  SERVER_DEPLOYMENT_GUIDE.md \
  GHL_QUICKSTART.md \
  GHL_ACCESS_GUIDE.md \
  2>/dev/null

if [ $? -eq 0 ]; then
  echo "✓ Package created successfully"
  echo ""
  
  # Show package size
  SIZE=$(ls -lh "${PACKAGE_NAME}.tar.gz" | awk '{print $5}')
  echo "Package size: ${SIZE}"
  echo ""
  
  echo "================================================"
  echo "Ready to Upload!"
  echo "================================================"
  echo ""
  echo "Run this command to upload to server:"
  echo ""
  echo "  scp -i ~/.ssh/nowserverk.pem ${PACKAGE_NAME}.tar.gz ec2-user@3.141.49.8:~/"
  echo ""
  echo "Then SSH and extract:"
  echo "  ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8"
  echo "  cd ~/gmh-dashboard"
  echo "  tar -xzf ~/${PACKAGE_NAME}.tar.gz"
  echo ""
  echo "See SERVER_DEPLOYMENT_GUIDE.md for complete instructions"
  echo ""
else
  echo "✗ Error creating package"
  exit 1
fi
