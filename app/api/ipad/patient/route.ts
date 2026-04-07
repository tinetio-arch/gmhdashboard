import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

async function healthieGraphQL(query: string, variables: Record<string, any> = {}) {
    const response = await fetch(HEALTHIE_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${HEALTHIE_API_KEY}`,
            'AuthorizationSource': 'API',
        },
        body: JSON.stringify({ query, variables }),
    });
    const data = await response.json();
    if (data.errors) {
        throw new Error(data.errors[0]?.message || 'Healthie API error');
    }
    return data.data;
}

// GET /api/ipad/patient?action=groups — Fetch all groups for dropdown
// GET /api/ipad/patient?action=tags — Fetch available tags
export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
        const action = request.nextUrl.searchParams.get('action');

        if (action === 'groups') {
            const data = await healthieGraphQL(`query {
                userGroups(should_paginate: false) {
                    id name users_count
                }
            }`);
            return NextResponse.json({
                success: true,
                groups: (data.userGroups || []).map((g: any) => ({
                    id: g.id,
                    name: g.name,
                    count: g.users_count,
                })),
            });
        }

        if (action === 'tags') {
            // Get commonly used tags
            const data = await healthieGraphQL(`query {
                tags { id name }
            }`);
            return NextResponse.json({
                success: true,
                tags: data.tags || [],
            });
        }

        if (action === 'video_session') {
            const appointmentId = request.nextUrl.searchParams.get('appointment_id');
            if (!appointmentId) {
                return NextResponse.json({ error: 'appointment_id is required' }, { status: 400 });
            }

            // FIX(2026-03-26): Query session_id + generated_token for Vonage/OpenTok video
            const data = await healthieGraphQL(`query GetVideoSession($id: ID) {
                appointment(id: $id) {
                    id
                    date
                    pm_status
                    contact_type
                    session_id
                    generated_token
                    zoom_join_url
                    zoom_meeting_id
                    provider { id first_name last_name }
                    attendees { id first_name last_name }
                    user { id first_name last_name }
                }
            }`, { id: appointmentId });

            const appt = data.appointment;
            if (!appt) {
                return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
            }

            const user = appt.user;
            const attendee = appt.attendees?.[0];
            // FIX(2026-03-31): Return patient Healthie ID so video page can use it for scribe/chart
            const patientHealthieId = attendee?.id || user?.id || null;
            return NextResponse.json({
                success: true,
                session: {
                    appointmentId: appt.id,
                    date: appt.date,
                    status: appt.pm_status,
                    contactType: appt.contact_type,
                    provider: appt.provider ? `${appt.provider.first_name} ${appt.provider.last_name}` : null,
                    patientName: user ? `${user.first_name} ${user.last_name}` : null,
                    patientHealthieId,
                    // Vonage/OpenTok native video (Healthie Video Call)
                    sessionId: appt.session_id || null,
                    token: appt.generated_token || null,
                    vonageApiKey: '45624682',
                    // Zoom fallback
                    zoomJoinUrl: appt.zoom_join_url || null,
                    zoomMeetingId: appt.zoom_meeting_id || null,
                },
            });
        }

        return NextResponse.json({ error: 'Missing action parameter' }, { status: 400 });
    } catch (error) {
        console.error('[API] iPad patient GET error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// PATCH /api/ipad/patient — Update patient group or tags
export async function PATCH(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');
        const body = await request.json();
        const { action, healthie_id } = body;

        if (!healthie_id) {
            return NextResponse.json({ error: 'healthie_id is required' }, { status: 400 });
        }

        // Change patient group
        if (action === 'change_group') {
            const { group_id } = body;
            if (!group_id) {
                return NextResponse.json({ error: 'group_id is required' }, { status: 400 });
            }

            const data = await healthieGraphQL(`mutation UpdateClient($input: updateClientInput!) {
                updateClient(input: $input) {
                    user {
                        id
                        user_group { id name }
                        active_tags { id name }
                    }
                    messages { field message }
                }
            }`, {
                input: { id: healthie_id, user_group_id: group_id }
            });

            const result = data.updateClient;
            if (result.messages && result.messages.length > 0) {
                console.error('[API] iPad change_group messages:', result.messages);
            }

            return NextResponse.json({
                success: true,
                user_group: result.user?.user_group || null,
                tags: result.user?.active_tags || [],
            });
        }

        // Add tag to patient
        if (action === 'add_tag') {
            const { tag_name } = body;
            if (!tag_name) {
                return NextResponse.json({ error: 'tag_name is required' }, { status: 400 });
            }

            console.log(`[iPad Tags] Adding tag "${tag_name}" to Healthie user ${healthie_id}`);

            // Step 1: Try createTag (creates new tag AND applies to patient)
            const data = await healthieGraphQL<any>(`mutation CreateTag($input: createTagInput!) {
                createTag(input: $input) {
                    tag { id name }
                    messages { field message }
                }
            }`, {
                input: { name: tag_name, taggable_user_id: healthie_id }
            });

            const result = data.createTag;

            // If createTag succeeded, return it
            if (result?.tag) {
                console.log(`[iPad Tags] New tag created & applied: ${result.tag.id} "${result.tag.name}"`);
                return NextResponse.json({ success: true, tag: result.tag });
            }

            // Step 2: If "already taken", the tag exists globally — find it and apply via bulkApply
            const hasAlreadyTaken = result?.messages?.some((m: any) =>
                (m.message || '').toLowerCase().includes('already been taken')
            );

            if (hasAlreadyTaken) {
                console.log(`[iPad Tags] Tag "${tag_name}" exists globally, applying via bulkApply`);

                // Find existing tag by name
                const tagsData = await healthieGraphQL<any>(`{ tags { id name } }`);
                const existingTag = (tagsData.tags || []).find(
                    (t: any) => t.name.toLowerCase() === tag_name.toLowerCase()
                );

                if (!existingTag) {
                    return NextResponse.json({
                        success: false,
                        error: `Tag "${tag_name}" exists but could not be found. Try a different name.`
                    }, { status: 400 });
                }

                // Apply existing tag to patient via bulkApply
                // FIX(2026-04-01): Healthie createTag fails for existing tags.
                // Use bulkApply(ids: [tagId], taggable_user_id) to apply existing tags.
                const applyData = await healthieGraphQL<any>(`mutation BulkApply($input: bulkApplyInput!) {
                    bulkApply(input: $input) {
                        tags { id name }
                        messages { field message }
                    }
                }`, {
                    input: { ids: [existingTag.id], taggable_user_id: healthie_id }
                });

                const applied = applyData.bulkApply;
                if (applied?.tags && applied.tags.length > 0) {
                    console.log(`[iPad Tags] Existing tag applied: ${applied.tags[0].id} "${applied.tags[0].name}"`);
                    return NextResponse.json({ success: true, tag: applied.tags[0] });
                }

                // Check for messages (e.g., already applied to this patient)
                if (applied?.messages && applied.messages.length > 0) {
                    return NextResponse.json({
                        success: false,
                        error: applied.messages.map((m: any) => m.message).join(', ')
                    }, { status: 400 });
                }

                // Fallback: return the tag we found even if bulkApply returned empty
                return NextResponse.json({ success: true, tag: existingTag });
            }

            // Other error from createTag
            if (result?.messages && result.messages.length > 0) {
                const errMsg = result.messages.map((m: any) => m.message).join(', ');
                console.warn('[iPad Tags] createTag error:', errMsg);
                return NextResponse.json({ success: false, error: errMsg }, { status: 400 });
            }

            return NextResponse.json({ success: false, error: 'Tag creation returned no result' }, { status: 500 });
        }

        // Remove tag from patient
        if (action === 'remove_tag') {
            const { tag_id } = body;
            if (!tag_id) {
                return NextResponse.json({ error: 'tag_id is required' }, { status: 400 });
            }

            // FIX(2026-04-01): Healthie removed 'appliedTag' from removeAppliedTagPayload.
            // Only request 'messages' which still exists.
            const data = await healthieGraphQL(`mutation RemoveTag($input: removeAppliedTagInput!) {
                removeAppliedTag(input: $input) {
                    messages { field message }
                }
            }`, {
                input: { id: tag_id, taggable_user_id: healthie_id }
            });

            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (error: any) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[API] iPad patient PATCH error:', msg);
        return NextResponse.json({ error: msg || 'Internal server error' }, { status: 500 });
    }
}
