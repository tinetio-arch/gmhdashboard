import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';

/**
 * GET /api/labs/pdf/[id] - Serve a lab PDF for viewing
 */
export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
): Promise<Response> {
    try {
        await requireApiUser(request, 'read');
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        throw error;
    }

    const { id } = params;
    const fs = await import('fs');
    const path = await import('path');

    // Load queue to find the item
    const QUEUE_FILE = '/home/ec2-user/gmhdashboard/data/labs-review-queue.json';

    let queue: any[] = [];
    try {
        const data = await fs.promises.readFile(QUEUE_FILE, 'utf-8');
        queue = JSON.parse(data);
    } catch {
        return NextResponse.json({ error: 'Queue not found' }, { status: 404 });
    }

    const item = queue.find(i => i.id === id);
    if (!item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // Priority 1: Check for S3 key - redirect to presigned URL
    if (item.s3_key) {
        try {
            const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
            const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

            const s3Client = new S3Client({ region: 'us-east-2' });
            const command = new GetObjectCommand({
                Bucket: 'gmh-clinical-data-lake',
                Key: item.s3_key,
            });

            const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

            // Redirect to S3 presigned URL
            return NextResponse.redirect(presignedUrl);
        } catch (error) {
            console.error('S3 presigned URL error:', error);
            // Fall through to other methods
        }
    }

    // Priority 2: Check for local PDF path
    if (item.pdf_path) {
        try {
            const pdfBuffer = await fs.promises.readFile(item.pdf_path);
            return new NextResponse(pdfBuffer, {
                status: 200,
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `inline; filename="lab_${id.slice(0, 8)}.pdf"`,
                },
            });
        } catch (error) {
            console.error('Error reading local PDF:', error);
            // Fall through to HTML generation
        }
    }

    // Priority 3: Generate HTML from raw_result
    if (item.raw_result) {
        const textContent = generateLabSummary(item);
        return new NextResponse(textContent, {
            status: 200,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Disposition': `inline; filename="lab_${id.slice(0, 8)}.html"`,
            },
        });
    }

    return NextResponse.json({ error: 'No PDF available' }, { status: 404 });
}

function generateLabSummary(item: any): string {
    const raw = item.raw_result || {};
    const orderedCodes = raw['Ordered Codes'] || [];

    let testsHtml = '';
    for (const panel of orderedCodes) {
        testsHtml += `<h3>${panel['Profile Name'] || 'Unknown Panel'}</h3>`;
        testsHtml += '<table style="width:100%;border-collapse:collapse;margin-bottom:1rem;">';
        testsHtml += '<tr><th style="border:1px solid #ddd;padding:8px;text-align:left;">Test</th>';
        testsHtml += '<th style="border:1px solid #ddd;padding:8px;text-align:left;">Result</th>';
        testsHtml += '<th style="border:1px solid #ddd;padding:8px;text-align:left;">Units</th>';
        testsHtml += '<th style="border:1px solid #ddd;padding:8px;text-align:left;">Range</th>';
        testsHtml += '<th style="border:1px solid #ddd;padding:8px;text-align:left;">Flag</th></tr>';

        for (const comp of (panel['Components'] || [])) {
            const flag = comp['Abnormal Flag'] || 'N';
            const flagColor = flag === 'H' || flag === 'HH' ? '#dc2626' :
                flag === 'L' || flag === 'LL' ? '#2563eb' : '#059669';
            testsHtml += `<tr>
                <td style="border:1px solid #ddd;padding:8px;">${comp['Test Name'] || ''}</td>
                <td style="border:1px solid #ddd;padding:8px;font-weight:bold;">${comp['Result'] || ''}</td>
                <td style="border:1px solid #ddd;padding:8px;">${comp['Test Units'] || ''}</td>
                <td style="border:1px solid #ddd;padding:8px;">${comp['Range'] || ''}</td>
                <td style="border:1px solid #ddd;padding:8px;color:${flagColor};font-weight:bold;">${flag}</td>
            </tr>`;
        }
        testsHtml += '</table>';
    }

    return `<!DOCTYPE html>
<html>
<head>
    <title>Lab Results - ${item.patient_name || 'Unknown'}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2rem; max-width: 900px; margin: 0 auto; }
        h1 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
        h2 { color: #334155; margin-top: 2rem; }
        h3 { color: #475569; margin-top: 1.5rem; }
        .meta { background: #f8fafc; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1.5rem; }
        .meta p { margin: 0.25rem 0; }
        .critical { background: #fee2e2; color: #dc2626; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-weight: bold; }
    </style>
</head>
<body>
    <h1>🧪 Lab Results</h1>
    
    <div class="meta">
        <p><strong>Patient:</strong> ${item.patient_name || 'Unknown'}</p>
        <p><strong>DOB:</strong> ${item.dob || raw['DOB'] || 'N/A'}</p>
        <p><strong>Accession:</strong> ${item.accession || raw['Accession'] || 'N/A'}</p>
        <p><strong>Collection Date:</strong> ${item.collection_date || raw['Collection Date'] || 'N/A'}</p>
        <p><strong>Gender:</strong> ${raw['Gender'] || 'N/A'}</p>
    </div>

    <h2>Test Results</h2>
    ${testsHtml || '<p>No test results available</p>'}
    
    <p style="color:#64748b;font-size:0.875rem;margin-top:2rem;">
        Generated from Access Labs data • ${new Date().toLocaleString()}
    </p>
</body>
</html>`;
}
