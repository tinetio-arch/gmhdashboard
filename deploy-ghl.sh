#!/bin/bash
# Deployment script for GHL Integration to nowoptimal.com/ops
# Run this on your EC2 server after SSH'ing in

set -e  # Exit on error

echo "================================================"
echo "GoHighLevel Integration Deployment"
echo "Target: nowoptimal.com/ops"
echo "================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: package.json not found. Please run this from the gmh-dashboard directory.${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Checking Node.js and npm...${NC}"
node --version
npm --version

echo ""
echo -e "${YELLOW}Step 2: Installing dependencies...${NC}"
npm install

echo ""
echo -e "${YELLOW}Step 3: Checking .env configuration...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo "Please create .env file with the following variables:"
    echo "  - GHL_API_KEY"
    echo "  - GHL_LOCATION_ID"
    echo "  - GHL_BASE_URL"
    echo "  - NEXT_PUBLIC_BASE_PATH=/ops"
    exit 1
fi

# Check for required GHL variables
if ! grep -q "GHL_API_KEY" .env; then
    echo -e "${RED}Warning: GHL_API_KEY not found in .env${NC}"
fi

if ! grep -q "GHL_LOCATION_ID" .env; then
    echo -e "${RED}Warning: GHL_LOCATION_ID not found in .env${NC}"
fi

if ! grep -q "NEXT_PUBLIC_BASE_PATH" .env; then
    echo -e "${YELLOW}Adding NEXT_PUBLIC_BASE_PATH=/ops to .env${NC}"
    echo "" >> .env
    echo "# Base path for deployment" >> .env
    echo "NEXT_PUBLIC_BASE_PATH=/ops" >> .env
fi

echo -e "${GREEN}Environment variables configured${NC}"

echo ""
echo -e "${YELLOW}Step 4: Running database migrations...${NC}"
if [ -f "scripts/run-ghl-migration.js" ]; then
    node scripts/run-ghl-migration.js
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ GHL migrations completed successfully${NC}"
    else
        echo -e "${RED}✗ Migration failed - check database connection${NC}"
        exit 1
    fi
else
    echo -e "${RED}Error: Migration script not found${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Step 5: Building application...${NC}"
npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Build completed successfully${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Step 6: Restarting PM2 process...${NC}"
if command -v pm2 &> /dev/null; then
    # Check if gmh-dashboard is already running
    if pm2 list | grep -q "gmh-dashboard"; then
        echo "Restarting existing PM2 process..."
        pm2 restart gmh-dashboard
    else
        echo "Starting new PM2 process..."
        pm2 start npm --name "gmh-dashboard" -- start
    fi
    
    pm2 save
    echo -e "${GREEN}✓ PM2 process restarted${NC}"
else
    echo -e "${YELLOW}PM2 not found. Starting with npm start...${NC}"
    echo "Consider installing PM2: npm install -g pm2"
fi

echo ""
echo "================================================"
echo -e "${GREEN}Deployment Complete!${NC}"
echo "================================================"
echo ""
echo "Next steps:"
echo "1. Visit https://nowoptimal.com/ops/patients"
echo "2. Click 'Sync All Patients' to link GHL contacts"
echo "3. Verify the 'existing' tag is applied to Men's Health patients"
echo ""
echo "To view logs:"
echo "  pm2 logs gmh-dashboard"
echo ""
echo "To monitor:"
echo "  pm2 monit"
echo ""
