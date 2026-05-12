#!/usr/bin/env node
/**
 * Generate product card images for peptides missing from WooCommerce.
 * Uses node-canvas to create 2400x2400 PNG cards matching ABXTAC brand style.
 *
 * Usage: node scripts/generate-peptide-cards.js [--dry-run]
 * Output: /home/ec2-user/abxtac-website/public/3d-vials/YPB.XXX_mockup.png
 */

const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const OUTPUT_DIR = '/home/ec2-user/abxtac-website/public/3d-vials';

const PRODUCTS = [
  { sku: 'YPB.250', name: 'AICAR', dose: '50mg', category: 'Metabolic' },
  { sku: 'YPB.251', name: 'B12', dose: '10ml', category: 'Vitamin' },
  { sku: 'YPB.252', name: 'DSIP', dose: '5mg', category: 'Sleep' },
  { sku: 'YPB.253', name: 'Epitalon', dose: '10mg', category: 'Anti-Aging' },
  { sku: 'YPB.254', name: 'Epitalon', dose: '50mg', category: 'Anti-Aging' },
  { sku: 'YPB.255', name: 'FOXO4', dose: '10mg', category: 'Senolytic' },
  { sku: 'YPB.256', name: 'HCG', dose: '10000iu', category: 'Hormonal' },
  { sku: 'YPB.257', name: 'GHRP-6 Acetate', dose: '10mg', category: 'GH Support' },
  { sku: 'YPB.258', name: 'HMG', dose: '75iu', category: 'Hormonal' },
  { sku: 'YPB.259', name: 'Glutathione', dose: '1500mg', category: 'Antioxidant' },
  { sku: 'YPB.261', name: 'Hexarelin Acetate', dose: '5mg', category: 'GH Support' },
  { sku: 'YPB.262', name: 'IGF-1 LR3', dose: '1mg', category: 'Growth Factor' },
  { sku: 'YPB.263', name: 'Ipamorelin', dose: '10mg', category: 'GH Support' },
  { sku: 'YPB.264', name: 'KLOW Blend', dose: 'GHK-Cu/KPV/BPC/TB', category: 'Recovery' },
  { sku: 'YPB.265', name: 'KPV', dose: '10mg', category: 'Anti-Inflammatory' },
  { sku: 'YPB.266', name: 'KissPeptin', dose: '10mg', category: 'Hormonal' },
  { sku: 'YPB.267', name: '8X Lipotropic Blend', dose: 'Multi', category: 'Weight Loss' },
  { sku: 'YPB.268', name: '4X MIC Blend', dose: 'Multi', category: 'Weight Loss' },
  { sku: 'YPB.269', name: 'Mazdutide', dose: '100mg', category: 'GLP Research' },
  { sku: 'YPB.270', name: 'Melanotan 2', dose: '10mg', category: 'Tanning' },
  { sku: 'YPB.271', name: 'MOTS-c', dose: '40mg', category: 'Mitochondrial' },
  { sku: 'YPB.272', name: 'Snap-8', dose: '10mg', category: 'Skin' },
  { sku: 'YPB.273', name: 'Pinealon', dose: '20mg', category: 'Nootropic' },
  { sku: 'YPB.274', name: 'PT-141', dose: '10mg', category: 'Libido' },
  { sku: 'YPB.275', name: 'PNC-27', dose: '10mg', category: 'Anticancer' },
  { sku: 'YPB.277', name: 'ARA-290', dose: '10mg', category: 'Neuroprotective' },
  { sku: 'YPB.278', name: 'Survodutide', dose: '10mg', category: 'GLP Research' },
  { sku: 'YPB.279', name: 'Tesamorelin', dose: '10mg', category: 'GH Support' },
  { sku: 'YPB.280', name: 'Thymalin', dose: '10mg', category: 'Immune' },
  { sku: 'YPB.281', name: 'VIP10', dose: '10mg', category: 'Neuroprotective' },
  { sku: 'YPB.282', name: 'GHRP-6 Acetate', dose: '5mg', category: 'GH Support' },
  { sku: 'YPB.283', name: 'Glutathione', dose: '600mg', category: 'Antioxidant' },
  { sku: 'YPB.285', name: 'IGF-1 LR3', dose: '0.1mg', category: 'Growth Factor' },
  { sku: 'YPB.286', name: 'IGF-DES', dose: '0.1mg', category: 'Growth Factor' },
  { sku: 'YPB.287', name: 'GLP-3 RZ', dose: '60mg', category: 'GLP Research' },
  { sku: 'YPB.288', name: 'Tesamorelin', dose: '20mg', category: 'GH Support' },
];

const CATEGORY_COLORS = {
  'Metabolic': '#10b981',
  'Vitamin': '#3b82f6',
  'Sleep': '#8b5cf6',
  'Anti-Aging': '#ec4899',
  'Senolytic': '#f59e0b',
  'Hormonal': '#ef4444',
  'GH Support': '#06b6d4',
  'Antioxidant': '#22c55e',
  'Growth Factor': '#f97316',
  'Recovery': '#7c3aed',
  'Anti-Inflammatory': '#14b8a6',
  'Weight Loss': '#e11d48',
  'GLP Research': '#6366f1',
  'Tanning': '#eab308',
  'Mitochondrial': '#a855f7',
  'Skin': '#fb923c',
  'Nootropic': '#0ea5e9',
  'Libido': '#f43f5e',
  'Anticancer': '#dc2626',
  'Neuroprotective': '#2dd4bf',
  'Immune': '#84cc16',
};

function generateCard(product) {
  const W = 2400, H = 2400;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background — dark gradient
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#0a0a14');
  bgGrad.addColorStop(1, '#111827');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Card container (centered, with subtle border)
  const cardX = 200, cardY = 200, cardW = 2000, cardH = 2000;
  const cardRadius = 60;

  // Card shadow
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 80;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 20;

  // Card background
  ctx.fillStyle = '#1a1a2e';
  roundRect(ctx, cardX, cardY, cardW, cardH, cardRadius);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Card border
  ctx.strokeStyle = 'rgba(124,58,237,0.3)';
  ctx.lineWidth = 3;
  roundRect(ctx, cardX, cardY, cardW, cardH, cardRadius);
  ctx.stroke();

  // ABXTAC logo area — top
  const logoY = 350;

  // Logo circle
  ctx.beginPath();
  ctx.arc(W / 2, logoY, 100, 0, Math.PI * 2);
  ctx.fillStyle = '#7c3aed';
  ctx.fill();

  // X in circle
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 90px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('X', W / 2, logoY);

  // ABXTAC text
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 48px sans-serif';
  ctx.fillText('ABXTAC', W / 2, logoY + 150);

  // Category badge — top right
  const catColor = CATEGORY_COLORS[product.category] || '#7c3aed';
  const catText = product.category.toUpperCase();
  ctx.font = 'bold 32px sans-serif';
  const catMetrics = ctx.measureText(catText);
  const badgeW = catMetrics.width + 40;
  const badgeH = 52;
  const badgeX = cardX + cardW - 60 - badgeW;
  const badgeY = cardY + 50;

  ctx.fillStyle = catColor;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 12);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(catText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 2);

  // Product name — large centered
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 120px sans-serif';

  // Handle long names
  const displayName = product.name;
  if (ctx.measureText(displayName).width > cardW - 200) {
    ctx.font = 'bold 80px sans-serif';
  }
  if (ctx.measureText(displayName).width > cardW - 200) {
    ctx.font = 'bold 60px sans-serif';
  }
  ctx.fillText(displayName, W / 2, 850);

  // Dose — green accent
  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 80px sans-serif';
  ctx.fillText(product.dose, W / 2, 980);

  // Divider line
  ctx.strokeStyle = 'rgba(124,58,237,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + 200, 1100);
  ctx.lineTo(cardX + cardW - 200, 1100);
  ctx.stroke();

  // SKU
  ctx.fillStyle = '#9ca3af';
  ctx.font = '40px sans-serif';
  ctx.fillText(product.sku, W / 2, 1200);

  // Vial icon area — stylized vial silhouette
  drawVialSilhouette(ctx, W / 2, 1550, catColor);

  // Bottom text
  ctx.fillStyle = '#6b7280';
  ctx.font = '32px sans-serif';
  ctx.fillText('Research Use Only', W / 2, 2050);

  return canvas;
}

function drawVialSilhouette(ctx, cx, cy, accentColor) {
  // Simple vial shape
  const vw = 120, vh = 320;
  const x = cx - vw / 2;
  const y = cy - vh / 2;

  // Cap
  ctx.fillStyle = '#4b5563';
  roundRect(ctx, x - 10, y - 30, vw + 20, 50, 8);
  ctx.fill();

  // Neck
  ctx.fillStyle = '#374151';
  ctx.fillRect(x + 20, y + 20, vw - 40, 40);

  // Body
  const bodyGrad = ctx.createLinearGradient(x, y + 60, x + vw, y + vh);
  bodyGrad.addColorStop(0, '#1f2937');
  bodyGrad.addColorStop(0.5, '#374151');
  bodyGrad.addColorStop(1, '#1f2937');
  ctx.fillStyle = bodyGrad;
  roundRect(ctx, x, y + 60, vw, vh - 60, 12);
  ctx.fill();

  // Label stripe
  ctx.fillStyle = accentColor;
  ctx.globalAlpha = 0.6;
  roundRect(ctx, x + 10, y + 120, vw - 20, 100, 6);
  ctx.fill();
  ctx.globalAlpha = 1.0;

  // Liquid level
  const liquidH = vh * 0.4;
  ctx.fillStyle = accentColor;
  ctx.globalAlpha = 0.15;
  roundRect(ctx, x + 4, y + vh - liquidH, vw - 8, liquidH - 4, 10);
  ctx.fill();
  ctx.globalAlpha = 1.0;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Main
console.log(`Generating ${PRODUCTS.length} peptide product cards...`);
if (DRY_RUN) console.log('(DRY RUN — no files will be written)');

let created = 0, skipped = 0;

for (const product of PRODUCTS) {
  const filename = `${product.sku}_mockup.png`;
  const outPath = path.join(OUTPUT_DIR, filename);

  if (fs.existsSync(outPath)) {
    console.log(`  SKIP (exists): ${filename}`);
    skipped++;
    continue;
  }

  if (DRY_RUN) {
    console.log(`  WOULD CREATE: ${filename} — ${product.name} ${product.dose}`);
    created++;
    continue;
  }

  const canvas = generateCard(product);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buffer);
  console.log(`  CREATED: ${filename} (${(buffer.length / 1024).toFixed(0)}KB) — ${product.name} ${product.dose}`);
  created++;
}

console.log(`\nDone: ${created} created, ${skipped} skipped`);
