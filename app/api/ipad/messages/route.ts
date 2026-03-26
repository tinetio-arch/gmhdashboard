import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { healthieGraphQL } from '@/lib/healthieApi';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/ipad/messages
 * Fetches conversations from Healthie messaging system.
 *
 * Query params:
 *   - conversation_id (optional): Get messages for a specific conversation
 *   - patient_id (optional): Get conversations for a specific patient (Healthie user ID)
 *   - offset (optional): Pagination offset for conversations list (default 0)
 */
export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');
    } catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const { searchParams } = new URL(request.url);
        const conversationId = searchParams.get('conversation_id');
        const patientId = searchParams.get('patient_id');
        const providerId = searchParams.get('provider_id');
        const offset = parseInt(searchParams.get('offset') || '0', 10);

        // If conversation_id provided, fetch messages for that conversation
        // FIX(2026-03-25): Healthie removed conversation_id arg from conversationMemberships
        // and removed notes from ConversationMembership type. Use top-level notes query instead.
        if (conversationId) {
            const data = await healthieGraphQL<{
                notes: Array<{
                    id: string;
                    content: string | null;
                    created_at: string;
                    creator: {
                        id: string;
                        full_name: string;
                    } | null;
                    attached_image_url: string | null;
                }>;
            }>(`
                query GetConversationMessages($convId: ID!, $offset: Int) {
                    notes(
                        conversation_id: $convId,
                        offset: $offset
                    ) {
                        id content created_at
                        creator { id full_name }
                        attached_image_url
                    }
                }
            `, { convId: conversationId, offset });

            const notes = data.notes || [];

            const messages = notes.map(note => ({
                id: note.id,
                content: note.content || '',
                created_at: note.created_at,
                sender_name: note.creator?.full_name || 'Unknown',
                sender_id: note.creator?.id || '',
                has_attachment: !!note.attached_image_url,
                attachment_url: note.attached_image_url || null,
            }));

            // Sort oldest first for chat display
            messages.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

            return NextResponse.json({
                success: true,
                conversation: {
                    id: conversationId,
                    name: 'Conversation',
                    owner_name: '',
                    last_message: messages.length > 0 ? messages[messages.length - 1].content : '',
                    updated_at: messages.length > 0 ? messages[messages.length - 1].created_at : new Date().toISOString(),
                },
                messages,
            });
        }

        // Otherwise list conversations
        // If patient_id provided, filter to that patient's conversations
        const queryStr = patientId
            ? `query GetPatientConversations($patientId: String, $offset: Int) {
                conversationMemberships(
                    client_id: $patientId,
                    offset: $offset,
                    read_status: "all"
                ) {
                    id
                    conversation_id
                    display_name
                    display_other_user_name
                    viewed
                    convo {
                        id name
                        owner { id full_name }
                        last_message_content
                        updated_at
                        conversation_memberships_count
                        dietitian_id
                    }
                }
            }`
            // FIX(2026-03-25): Healthie removed provider_scope and includes_provider from schema
            : providerId
            ? `query GetProviderConversations($providerId: ID, $offset: Int) {
                conversationMemberships(
                    provider_id: $providerId,
                    offset: $offset,
                    read_status: "all",
                    active_status: "active"
                ) {
                    id
                    conversation_id
                    display_name
                    display_other_user_name
                    viewed
                    convo {
                        id name
                        owner { id full_name }
                        last_message_content
                        updated_at
                        conversation_memberships_count
                        dietitian_id
                        conversation_memberships {
                            display_name
                        }
                    }
                }
            }`
            : `query GetAllConversations($offset: Int) {
                conversationMemberships(
                    offset: $offset,
                    read_status: "all",
                    active_status: "active"
                ) {
                    id
                    conversation_id
                    display_name
                    display_other_user_name
                    viewed
                    convo {
                        id name
                        owner { id full_name }
                        last_message_content
                        updated_at
                        conversation_memberships_count
                        dietitian_id
                        conversation_memberships {
                            display_name
                        }
                    }
                }
            }`;

        const variables: Record<string, unknown> = { offset };
        if (patientId) variables.patientId = patientId;
        if (providerId) variables.providerId = providerId;

        const data = await healthieGraphQL<{
            conversationMemberships: Array<{
                id: string;
                conversation_id: string;
                display_name: string | null;
                display_other_user_name: string | null;
                viewed: boolean;
                convo: {
                    id: string;
                    name: string | null;
                    owner: { id: string; full_name: string } | null;
                    last_message_content: string | null;
                    updated_at: string;
                    conversation_memberships_count: number;
                    dietitian_id: string | null;
                    conversation_memberships: Array<{ display_name: string | null }>;
                } | null;
            }>;
        }>(queryStr, variables);

        const conversations = (data.conversationMemberships || [])
            .filter(m => m.convo)
            .map(m => ({
                id: m.convo!.id,
                membership_id: m.id,
                name: m.display_name || m.display_other_user_name || m.convo!.name || 'Conversation',
                last_message: m.convo!.last_message_content || '',
                updated_at: m.convo!.updated_at,
                unread: !m.viewed,
                member_count: m.convo!.conversation_memberships_count || 0,
                members: (m.convo!.conversation_memberships || [])
                    .map(cm => cm.display_name)
                    .filter(Boolean),
                owner_name: m.convo!.owner?.full_name || '',
            }));

        // Sort by most recent first
        conversations.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

        return NextResponse.json({ success: true, conversations });
    } catch (error) {
        console.error('[iPad Messages] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to load messages' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/ipad/messages
 * Send a message in a conversation or create a new conversation.
 *
 * Body:
 *   - action: 'send' | 'create'
 *
 *   For 'send':
 *     - conversation_id: string
 *     - content: string
 *
 *   For 'create':
 *     - recipient_id: string (Healthie user ID)
 *     - content: string (initial message)
 *     - subject: string (optional conversation name)
 */
export async function POST(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');
    } catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const body = await request.json();
        const { action } = body;

        if (action === 'send') {
            const { conversation_id, content } = body;
            if (!conversation_id || !content?.trim()) {
                return NextResponse.json({ error: 'conversation_id and content are required' }, { status: 400 });
            }

            const data = await healthieGraphQL<{
                createNote: { note: { id: string; content: string; created_at: string } | null; messages: Array<{ field: string; message: string }> };
            }>(`
                mutation SendMessage($convId: String!, $content: String) {
                    createNote(input: {
                        conversation_id: $convId,
                        content: $content
                    }) {
                        note {
                            id content created_at
                        }
                        messages { field message }
                    }
                }
            `, { convId: conversation_id, content: content.trim() });

            if (data.createNote?.messages?.length) {
                const errMsg = data.createNote.messages.map(m => m.message).join(', ');
                return NextResponse.json({ error: errMsg }, { status: 400 });
            }

            return NextResponse.json({
                success: true,
                message: data.createNote?.note ? {
                    id: data.createNote.note.id,
                    content: data.createNote.note.content,
                    created_at: data.createNote.note.created_at,
                } : null,
            });

        } else if (action === 'add_member') {
            const { conversation_id, user_id } = body;
            if (!conversation_id || !user_id) {
                return NextResponse.json({ error: 'conversation_id and user_id are required' }, { status: 400 });
            }

            const data = await healthieGraphQL<{
                updateConversation: {
                    conversation: { id: string } | null;
                    messages: Array<{ field: string; message: string }>;
                };
            }>(`
                mutation AddMember($convId: ID, $userId: String) {
                    updateConversation(input: {
                        id: $convId,
                        simple_added_users: $userId
                    }) {
                        conversation { id }
                        messages { field message }
                    }
                }
            `, { convId: conversation_id, userId: user_id });

            if (data.updateConversation?.messages?.length) {
                const errMsg = data.updateConversation.messages.map(m => m.message).join(', ');
                return NextResponse.json({ error: errMsg }, { status: 400 });
            }

            return NextResponse.json({ success: true });

        } else if (action === 'get_staff') {
            const data = await healthieGraphQL<{
                organizationMembers: Array<{
                    id: string;
                    first_name: string | null;
                    last_name: string | null;
                }>;
            }>(`
                query { organizationMembers(page_size: 50) { id first_name last_name } }
            `);

            const staff = (data.organizationMembers || []).map(m => ({
                id: m.id,
                name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Unknown',
            }));

            return NextResponse.json({ success: true, staff });

        } else if (action === 'delete') {
            const { note_id } = body;
            if (!note_id) {
                return NextResponse.json({ error: 'note_id is required' }, { status: 400 });
            }

            await healthieGraphQL(`
                mutation DeleteNote($id: ID) {
                    deleteNote(input: { id: $id }) {
                        note { id }
                        messages { field message }
                    }
                }
            `, { id: note_id });

            return NextResponse.json({ success: true });

        } else if (action === 'create') {
            const { recipient_id, content, subject } = body;
            if (!recipient_id) {
                return NextResponse.json({ error: 'recipient_id is required' }, { status: 400 });
            }

            // Create conversation with the patient
            const createData = await healthieGraphQL<{
                createConversation: {
                    conversation: { id: string; name: string } | null;
                    messages: Array<{ field: string; message: string }>;
                };
            }>(`
                mutation CreateConversation($recipientId: String!, $name: String) {
                    createConversation(input: {
                        simple_added_users: $recipientId,
                        name: $name
                    }) {
                        conversation {
                            id name
                        }
                        messages { field message }
                    }
                }
            `, { recipientId: recipient_id, name: subject || null });

            if (createData.createConversation?.messages?.length) {
                const errMsg = createData.createConversation.messages.map(m => m.message).join(', ');
                return NextResponse.json({ error: errMsg }, { status: 400 });
            }

            const newConvo = createData.createConversation?.conversation;
            if (!newConvo) {
                return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
            }

            // Send initial message if provided
            if (content?.trim()) {
                await healthieGraphQL(`
                    mutation SendInitialMessage($convId: String!, $content: String) {
                        createNote(input: {
                            conversation_id: $convId,
                            content: $content
                        }) {
                            note { id }
                            messages { field message }
                        }
                    }
                `, { convId: newConvo.id, content: content.trim() });
            }

            return NextResponse.json({
                success: true,
                conversation: {
                    id: newConvo.id,
                    name: newConvo.name || 'New Conversation',
                },
            });

        } else if (action === 'search_patients') {
            // FIX(2026-03-25): Search Healthie users directly so all patients are findable
            const { search } = body;
            if (!search?.trim() || search.trim().length < 2) {
                return NextResponse.json({ error: 'search must be at least 2 characters' }, { status: 400 });
            }

            const data = await healthieGraphQL<{
                users: Array<{
                    id: string;
                    first_name: string | null;
                    last_name: string | null;
                    email: string | null;
                }>;
            }>(`
                query SearchHealthieUsers($keywords: String!) {
                    users(keywords: $keywords, offset: 0, page_size: 20) {
                        id first_name last_name email
                    }
                }
            `, { keywords: search.trim() });

            const patients = (data.users || []).map(u => ({
                healthie_id: u.id,
                full_name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Unknown',
                email: u.email || '',
            }));

            return NextResponse.json({ success: true, patients });

        } else {
            return NextResponse.json({ error: 'Invalid action. Use "send", "create", or "search_patients"' }, { status: 400 });
        }
    } catch (error) {
        console.error('[iPad Messages] POST Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to process message' },
            { status: 500 }
        );
    }
}
