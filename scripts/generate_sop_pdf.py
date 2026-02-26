#!/usr/bin/env python3
"""
SOP PDF Generator
Converts Markdown SOPs to professional PDF format using ReportLab.
"""

import sys
import os
import re
from reportlab.lib.pagesizes import LETTER
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER, TA_LEFT

def parse_markdown(md_content):
    """Simple parser to convert MD to ReportLab flowables"""
    flowables = []
    styles = getSampleStyleSheet()
    
    # Custom Styles
    styles.add(ParagraphStyle(name='SOPTitle', parent=styles['Heading1'], fontSize=24, alignment=TA_CENTER, spaceAfter=20, textColor=colors.navy))
    styles.add(ParagraphStyle(name='SOPHeader', parent=styles['Normal'], fontSize=10, textColor=colors.grey))
    styles.add(ParagraphStyle(name='SectionHeader', parent=styles['Heading2'], fontSize=14, spaceBefore=15, spaceAfter=10, textColor=colors.darkblue, borderPadding=5, borderColor=colors.lightgrey, borderWidth=0, borderBottomWidth=1))
    styles.add(ParagraphStyle(name='SubSectionHeader', parent=styles['Heading3'], fontSize=12, spaceBefore=10, spaceAfter=5, textColor=colors.black))
    # BodyText usually exists, update or add if missing
    if 'BodyText' in styles:
        styles['BodyText'].fontSize = 10
        styles['BodyText'].leading = 14
        styles['BodyText'].spaceAfter = 8
    else:
        styles.add(ParagraphStyle(name='BodyText', parent=styles['Normal'], fontSize=10, leading=14, spaceAfter=8))
        
    if 'BulletPoint' in styles:
        styles['BulletPoint'].fontSize = 10
        styles['BulletPoint'].leading = 14
        styles['BulletPoint'].leftIndent = 20
        styles['BulletPoint'].spaceAfter = 4
        styles['BulletPoint'].bulletIndent = 10
    else:
        styles.add(ParagraphStyle(name='BulletPoint', parent=styles['Normal'], fontSize=10, leading=14, leftIndent=20, spaceAfter=4, bulletIndent=10))

    styles.add(ParagraphStyle(name='WarningBox', parent=styles['Normal'], fontSize=10, leading=14, backColor=colors.lightyellow, borderColor=colors.orange, borderWidth=1, borderPadding=10, spaceAfter=10))

    lines = md_content.split('\n')
    in_table = False
    table_data = []
    
    for line in lines:
        line = line.rstrip()
        
        # TABLES
        if line.startswith('|'):
            if not in_table:
                in_table = True
                table_data = []
            
            # Simple pipe split, remove empty ends
            row = [cell.strip() for cell in line.split('|') if cell]
            # Remove separator rows (---)
            if '---' in row[0]:
                continue
            table_data.append([Paragraph(cell, styles['BodyText']) for cell in row])
            continue
        elif in_table:
            in_table = False
            if table_data:
                t = Table(table_data, colWidths=[1.5*inch, 1.5*inch, 3*inch, 1.5*inch]) # Approximate
                t.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.navy),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                    ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                    ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
                    ('GRID', (0, 0), (-1, -1), 1, colors.black),
                ]))
                flowables.append(t)
                flowables.append(Spacer(1, 12))
        
        # HEADERS
        if line.startswith('# '):
            flowables.append(Paragraph(line[2:], styles['SOPTitle']))
            flowables.append(Spacer(1, 20))
        elif line.startswith('## '):
            flowables.append(Paragraph(line[3:], styles['SectionHeader']))
        elif line.startswith('### '):
            flowables.append(Paragraph(line[4:], styles['SubSectionHeader']))
        
        # LISTS
        elif line.strip().startswith('- '):
            text = line.strip()[2:]
            # Bold handling
            text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
            flowables.append(Paragraph(f"• {text}", styles['BulletPoint']))
        
        # ALERTS/BLOCKQUOTES
        elif line.startswith('> '):
            text = line[2:]
            text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
            flowables.append(Paragraph(text, styles['WarningBox']))
        
        # NORMAL TEXT
        elif line.strip():
            # Skip horizontal rules
            if line.strip() == '---':
                flowables.append(Spacer(1, 10))
                continue
                
            text = line
            # Bold handling
            text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
            # Code handling
            text = re.sub(r'`(.*?)`', r'<font name="Courier">\1</font>', text)
            
            flowables.append(Paragraph(text, styles['BodyText']))
            
    return flowables

def create_sop_pdf(md_file, output_file):
    with open(md_file, 'r') as f:
        md_content = f.read()
    
    doc = SimpleDocTemplate(output_file, pagesize=LETTER)
    flowables = parse_markdown(md_content)
    
    # Add Logo if exists (optional)
    # logo = Image('logo.png', width=2*inch, height=1*inch)
    # flowables.insert(0, logo)
    
    doc.build(flowables)
    print(f"✅ Generated PDF: {output_file}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 generate_sop_pdf.py <input.md> <output.pdf>")
        sys.exit(1)
        
    create_sop_pdf(sys.argv[1], sys.argv[2])
