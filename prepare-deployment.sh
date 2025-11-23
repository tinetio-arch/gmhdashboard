#!/bin/bash
# Pre-deployment checklist and setup for nowoptimal.com/ops

echo "=============================================="
echo "Pre-Deployment Checklist"
echo "=============================================="
echo ""

# Function to prompt yes/no
confirm() {
    read -p "$1 (y/n): " response
    case "$response" in
        [yY]|[yY][eE][sS]) return 0 ;;
        *) return 1 ;;
    esac
}

# Checklist
echo "Please confirm the following:"
echo ""

if confirm "1. Do you have SSH access to the server (ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8)?"; then
    echo "   ✓ SSH access confirmed"
else
    echo "   ✗ Please ensure you have SSH access before proceeding"
    exit 1
fi

if confirm "2. Do you have your GoHighLevel API Key?"; then
    echo "   ✓ GHL API Key ready"
else
    echo "   ✗ Get your API key from: https://app.gohighlevel.com → Settings → Integrations → API"
    exit 1
fi

if confirm "3. Do you have your GoHighLevel Location ID?"; then
    echo "   ✓ GHL Location ID ready"
else
    echo "   ✗ Get Location ID from GHL URL or Settings"
    exit 1
fi

if confirm "4. Have you backed up the current production database?"; then
    echo "   ✓ Database backup confirmed"
else
    echo "   ✗ Please backup the database before proceeding"
    exit 1
fi

if confirm "5. Is the application currently running without errors?"; then
    echo "   ✓ Application status confirmed"
else
    echo "   ! Warning: Consider fixing existing issues before deploying"
    if ! confirm "   Continue anyway?"; then
        exit 1
    fi
fi

echo ""
echo "=============================================="
echo "Generating deployment package..."
echo "=============================================="
echo ""

# Create deployment directory
DEPLOY_DIR="ghl-deployment-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEPLOY_DIR"

# Copy necessary files
echo "Copying files to $DEPLOY_DIR..."

# Core integration files
mkdir -p "$DEPLOY_DIR/lib"
mkdir -p "$DEPLOY_DIR/app/api/admin/ghl/sync"
mkdir -p "$DEPLOY_DIR/app/api/cron/sync-ghl"
mkdir -p "$DEPLOY_DIR/components"
mkdir -p "$DEPLOY_DIR/migrations"
mkdir -p "$DEPLOY_DIR/scripts"

cp lib/patientGHLSync.ts "$DEPLOY_DIR/lib/" 2>/dev/null || echo "Warning: patientGHLSync.ts not found"
cp app/api/admin/ghl/sync/route.ts "$DEPLOY_DIR/app/api/admin/ghl/sync/" 2>/dev/null
cp app/api/cron/sync-ghl/route.ts "$DEPLOY_DIR/app/api/cron/sync-ghl/" 2>/dev/null
cp components/GHLSyncBadge.tsx "$DEPLOY_DIR/components/" 2>/dev/null
cp components/GHLBulkSync.tsx "$DEPLOY_DIR/components/" 2>/dev/null
cp app/patients/page.tsx "$DEPLOY_DIR/app/patients/" 2>/dev/null || mkdir -p "$DEPLOY_DIR/app/patients"
cp lib/patientQueries.ts "$DEPLOY_DIR/lib/" 2>/dev/null
cp migrations/20251122_add_ghl_sync.sql "$DEPLOY_DIR/migrations/" 2>/dev/null
cp migrations/20251122_update_patient_views_ghl.sql "$DEPLOY_DIR/migrations/" 2>/dev/null
cp scripts/run-ghl-migration.js "$DEPLOY_DIR/scripts/" 2>/dev/null
cp next.config.js "$DEPLOY_DIR/" 2>/dev/null
cp deploy-ghl.sh "$DEPLOY_DIR/" 2>/dev/null
cp DEPLOYMENT_GHL.md "$DEPLOY_DIR/" 2>/dev/null
cp GHL_QUICKSTART.md "$DEPLOY_DIR/" 2>/dev/null
cp GHL_ACCESS_GUIDE.md "$DEPLOY_DIR/" 2>/dev/null
cp GHL_INTEGRATION_GUIDE.md "$DEPLOY_DIR/" 2>/dev/null
cp env.production "$DEPLOY_DIR/" 2>/dev/null

# Create archive
echo ""
echo "Creating deployment archive..."
tar -czf "${DEPLOY_DIR}.tar.gz" "$DEPLOY_DIR"

echo ""
echo "=============================================="
echo "Deployment package created!"
echo "=============================================="
echo ""
echo "Archive: ${DEPLOY_DIR}.tar.gz"
echo ""
echo "Next steps:"
echo ""
echo "1. Upload to server:"
echo "   scp -i ~/.ssh/nowserverk.pem ${DEPLOY_DIR}.tar.gz ec2-user@3.141.49.8:~/"
echo ""
echo "2. SSH into server:"
echo "   ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8"
echo ""
echo "3. On the server, run:"
echo "   cd ~"
echo "   tar -xzf ${DEPLOY_DIR}.tar.gz"
echo "   cd ${DEPLOY_DIR}"
echo "   cat DEPLOYMENT_GHL.md  # Read deployment instructions"
echo ""
echo "4. Or run the automated deployment:"
echo "   cd ~/gmh-dashboard"
echo "   cp ~/${DEPLOY_DIR}/* . -r"
echo "   chmod +x deploy-ghl.sh"
echo "   ./deploy-ghl.sh"
echo ""

# Clean up temporary directory (keep archive)
rm -rf "$DEPLOY_DIR"

echo "Temporary files cleaned up. Archive ready for deployment."
echo ""
