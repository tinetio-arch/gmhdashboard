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
    await requireApiUser(request, 'read');

    try {
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

            const data = await healthieGraphQL(`query GetVideoSession($id: ID) {
                appointment(id: $id) {
                    id
                    date
                    pm_status
                    contact_type
                    zoom_join_url
                    zoom_meeting_id
                    provider { id first_name last_name }
                    attendees { id first_name last_name }
                }
            }`, { id: appointmentId });

            const appt = data.appointment;
            if (!appt) {
                return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
            }

            return NextResponse.json({
                success: true,
                session: {
                    appointmentId: appt.id,
                    date: appt.date,
                    status: appt.pm_status,
                    contactType: appt.contact_type,
                    provider: appt.provider ? `${appt.provider.first_name} ${appt.provider.last_name}` : null,
                    zoomJoinUrl: appt.zoom_join_url || null,
                    zoomMeetingId: appt.zoom_meeting_id || null,
                    vonageApiKey: '45624682',
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
    await requireApiUser(request, 'write');

    try {
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

            const data = await healthieGraphQL(`mutation CreateTag($input: createTagInput!) {
                createTag(input: $input) {
                    tag { id name }
                    messages { field message }
                }
            }`, {
                input: { name: tag_name, taggable_user_id: healthie_id }
            });

            const result = data.createTag;
            return NextResponse.json({
                success: true,
                tag: result.tag || null,
            });
        }

        // Remove tag from patient
        if (action === 'remove_tag') {
            const { tag_id } = body;
            if (!tag_id) {
                return NextResponse.json({ error: 'tag_id is required' }, { status: 400 });
            }

            const data = await healthieGraphQL(`mutation RemoveTag($input: removeAppliedTagInput!) {
                removeAppliedTag(input: $input) {
                    appliedTag { id }
                    messages { field message }
                }
            }`, {
                input: { id: tag_id, taggable_user_id: healthie_id }
            });

            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (error) {
        console.error('[API] iPad patient PATCH error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
