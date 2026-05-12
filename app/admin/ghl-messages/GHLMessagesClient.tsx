'use client';

import { useEffect, useState, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────

interface Conversation {
  id: string;
  contactId: string;
  contactName: string;
  phone: string | null;
  lastMessageDate: number | null;
  lastMessageType: string | null;
  lastMessageBody: string | null;
  lastMessageDirection: 'inbound' | 'outbound' | null;
  unreadCount: number;
  tags: string[];
  storedMessageCount?: number;
}

interface StoredMessage {
  id: number;
  messageId: string | null;
  direction: string;
  messageType: string;
  body: string | null;
  contactName: string | null;
  contactPhone: string | null;
  timestamp: string;
}

interface ConversationsResponse {
  account: string;
  total: number;
  conversations: Conversation[];
}

interface ThreadResponse {
  account: string;
  contactId: string;
  total: number;
  messages: StoredMessage[];
}

type SubAccount = 'mensHealth' | 'primaryCare' | 'abxtac';

const TABS: { key: SubAccount; label: string; color: string; bgColor: string }[] = [
  { key: 'mensHealth', label: "Men's Health", color: '#DC2626', bgColor: 'rgba(220,38,38,0.08)' },
  { key: 'primaryCare', label: 'Primary Care', color: '#060F6A', bgColor: 'rgba(6,15,106,0.08)' },
  { key: 'abxtac', label: 'ABXTAC', color: '#3A7D32', bgColor: 'rgba(58,125,50,0.08)' },
];

// ── Helpers ─────────────────────────────────────────────────────────

function formatTimestamp(ts: number | string | null): string {
  if (!ts) return '';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (isToday) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();

  if (isYesterday) {
    return 'Yesterday ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function messageTypeLabel(type: string | null): string {
  if (!type) return '';
  return type.replace('TYPE_', '').toLowerCase();
}

function typeBadgeStyle(msgType: string): { background: string; color: string } {
  switch (msgType) {
    case 'sms': return { background: '#dbeafe', color: '#1e40af' };
    case 'call': return { background: '#fef3c7', color: '#92400e' };
    case 'email': return { background: '#ede9fe', color: '#6d28d9' };
    case 'voicemail': return { background: '#fce7f3', color: '#9d174d' };
    default: return { background: '#f3f4f6', color: '#6b7280' };
  }
}

// ── Component ───────────────────────────────────────────────────────

export default function GHLMessagesClient() {
  const [activeTab, setActiveTab] = useState<SubAccount>('mensHealth');
  const [data, setData] = useState<Record<SubAccount, ConversationsResponse | null>>({
    mensHealth: null, primaryCare: null, abxtac: null,
  });
  const [loading, setLoading] = useState<Record<SubAccount, boolean>>({
    mensHealth: false, primaryCare: false, abxtac: false,
  });
  const [errors, setErrors] = useState<Record<SubAccount, string | null>>({
    mensHealth: null, primaryCare: null, abxtac: null,
  });

  // Reply state
  const [replyTarget, setReplyTarget] = useState<Conversation | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Thread expansion state
  const [expandedContact, setExpandedContact] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<StoredMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);

  const fetchAccount = useCallback(async (account: SubAccount) => {
    setLoading(prev => ({ ...prev, [account]: true }));
    setErrors(prev => ({ ...prev, [account]: null }));
    try {
      const res = await fetch(`/ops/api/admin/ghl/conversations?account=${account}&limit=15`);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      const json: ConversationsResponse = await res.json();
      setData(prev => ({ ...prev, [account]: json }));
    } catch (e: any) {
      setErrors(prev => ({ ...prev, [account]: e.message }));
    } finally {
      setLoading(prev => ({ ...prev, [account]: false }));
    }
  }, []);

  const fetchThread = useCallback(async (contactId: string) => {
    setThreadLoading(true);
    try {
      const res = await fetch(`/ops/api/admin/ghl/conversations?account=${activeTab}&contactId=${contactId}&limit=30`);
      if (!res.ok) throw new Error('Failed to load thread');
      const json: ThreadResponse = await res.json();
      setThreadMessages(json.messages || []);
    } catch {
      setThreadMessages([]);
    } finally {
      setThreadLoading(false);
    }
  }, [activeTab]);

  // Load all accounts on mount
  useEffect(() => {
    TABS.forEach(tab => fetchAccount(tab.key));
  }, [fetchAccount]);

  const handleExpandThread = (convo: Conversation) => {
    if (expandedContact === convo.contactId) {
      setExpandedContact(null);
      setThreadMessages([]);
    } else {
      setExpandedContact(convo.contactId);
      fetchThread(convo.contactId);
    }
  };

  const handleSendReply = async () => {
    if (!replyTarget || !replyText.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch('/ops/api/admin/ghl/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: activeTab,
          contactId: replyTarget.contactId,
          message: replyText.trim(),
          contactName: replyTarget.contactName,
          contactPhone: replyTarget.phone,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to send');
      setSendResult({ ok: true, msg: `Sent to ${replyTarget.contactName}` });
      setReplyText('');
      setReplyTarget(null);
      // Refresh current tab and thread
      fetchAccount(activeTab);
      if (expandedContact === replyTarget.contactId) {
        fetchThread(replyTarget.contactId);
      }
    } catch (e: any) {
      setSendResult({ ok: false, msg: e.message });
    } finally {
      setSending(false);
    }
  };

  const activeTabInfo = TABS.find(t => t.key === activeTab)!;
  const conversations = data[activeTab]?.conversations || [];
  const isLoading = loading[activeTab];
  const error = errors[activeTab];

  return (
    <div style={{ padding: '24px', maxWidth: '960px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>GHL Messages</h1>
        <p style={{ color: '#6b7280', fontSize: '13px', marginTop: '4px' }}>
          Text &amp; call activity across GHL sub-accounts. Showing last message per conversation from GHL +
          stored message threads from webhook capture.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid #e5e7eb' }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          const unreadTotal = data[tab.key]?.conversations?.reduce((sum, c) => sum + (c.unreadCount || 0), 0) || 0;
          return (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                setReplyTarget(null);
                setReplyText('');
                setSendResult(null);
                setExpandedContact(null);
                setThreadMessages([]);
              }}
              style={{
                padding: '10px 20px',
                border: 'none',
                borderBottom: isActive ? `3px solid ${tab.color}` : '3px solid transparent',
                background: isActive ? tab.bgColor : 'transparent',
                color: isActive ? tab.color : '#6b7280',
                fontWeight: isActive ? 700 : 500,
                fontSize: '14px',
                cursor: 'pointer',
                borderRadius: '6px 6px 0 0',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {tab.label}
              {unreadTotal > 0 && (
                <span style={{
                  background: tab.color, color: '#fff', borderRadius: '10px',
                  padding: '1px 7px', fontSize: '11px', fontWeight: 700,
                }}>{unreadTotal}</span>
              )}
            </button>
          );
        })}
        <button
          onClick={() => fetchAccount(activeTab)}
          disabled={isLoading}
          style={{
            marginLeft: 'auto', padding: '6px 14px', background: '#f3f4f6',
            border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px',
            cursor: isLoading ? 'not-allowed' : 'pointer', color: '#374151',
            alignSelf: 'center', marginBottom: '4px',
          }}
        >
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Send result banner */}
      {sendResult && (
        <div style={{
          padding: '10px 16px', marginBottom: '16px', borderRadius: '8px',
          background: sendResult.ok ? '#dcfce7' : '#fef2f2',
          color: sendResult.ok ? '#166534' : '#991b1b',
          fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{sendResult.msg}</span>
          <button onClick={() => setSendResult(null)} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '16px', color: 'inherit',
          }}>x</button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px 16px', marginBottom: '16px', borderRadius: '8px',
          background: '#fef2f2', color: '#991b1b', fontSize: '13px',
        }}>Failed to load: {error}</div>
      )}

      {/* Loading */}
      {isLoading && conversations.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>Loading conversations...</div>
      )}

      {/* Empty state */}
      {!isLoading && conversations.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>
          No conversations found for this account.
        </div>
      )}

      {/* Conversations list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {conversations.map(convo => {
          const isInbound = convo.lastMessageDirection === 'inbound';
          const isReplyOpen = replyTarget?.id === convo.id;
          const isExpanded = expandedContact === convo.contactId;
          const msgType = messageTypeLabel(convo.lastMessageType);
          const badge = typeBadgeStyle(msgType);

          return (
            <div key={convo.id}>
              {/* Conversation row */}
              <div
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '12px',
                  padding: '12px 16px', borderRadius: isExpanded ? '8px 8px 0 0' : '8px',
                  background: convo.unreadCount > 0 ? activeTabInfo.bgColor : '#fff',
                  border: '1px solid #e5e7eb',
                  borderBottom: isExpanded ? 'none' : '1px solid #e5e7eb',
                  transition: 'background 0.15s',
                }}
              >
                {/* Direction arrow */}
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, marginTop: '2px',
                  background: isInbound ? '#dbeafe' : '#f0fdf4',
                  color: isInbound ? '#1d4ed8' : '#16a34a',
                  fontSize: '14px', fontWeight: 700,
                }}>
                  {isInbound ? '\u2190' : '\u2192'}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{
                        fontWeight: convo.unreadCount > 0 ? 700 : 600,
                        fontSize: '14px', color: '#111827',
                      }}>{convo.contactName}</span>
                      {convo.phone && (
                        <span style={{ fontSize: '12px', color: '#9ca3af' }}>{convo.phone}</span>
                      )}
                      <span style={{
                        fontSize: '11px', padding: '1px 6px', borderRadius: '4px',
                        background: badge.background, color: badge.color,
                        fontWeight: 600, textTransform: 'uppercase',
                      }}>{msgType}</span>
                      {(convo.storedMessageCount || 0) > 0 && (
                        <span style={{
                          fontSize: '11px', padding: '1px 6px', borderRadius: '4px',
                          background: '#f0f9ff', color: '#0369a1', fontWeight: 600,
                        }}>
                          {convo.storedMessageCount} stored
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '12px', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                      {formatTimestamp(convo.lastMessageDate)}
                    </span>
                  </div>

                  {convo.lastMessageBody && (
                    <p style={{
                      margin: 0, fontSize: '13px', color: '#4b5563', lineHeight: '1.4',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    }}>{convo.lastMessageBody}</p>
                  )}

                  {/* Action buttons */}
                  <div style={{ marginTop: '6px', display: 'flex', gap: '12px' }}>
                    <button
                      onClick={() => {
                        if (isReplyOpen) { setReplyTarget(null); setReplyText(''); }
                        else { setReplyTarget(convo); setReplyText(''); }
                      }}
                      style={{
                        background: 'none', border: 'none', color: activeTabInfo.color,
                        fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: '2px 0',
                      }}
                    >{isReplyOpen ? 'Cancel' : 'Reply'}</button>

                    {(convo.storedMessageCount || 0) > 0 && (
                      <button
                        onClick={() => handleExpandThread(convo)}
                        style={{
                          background: 'none', border: 'none', color: '#0369a1',
                          fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: '2px 0',
                        }}
                      >{isExpanded ? 'Hide thread' : 'View thread'}</button>
                    )}
                  </div>
                </div>

                {/* Unread badge */}
                {convo.unreadCount > 0 && (
                  <span style={{
                    background: activeTabInfo.color, color: '#fff', borderRadius: '10px',
                    padding: '2px 8px', fontSize: '11px', fontWeight: 700,
                    flexShrink: 0, alignSelf: 'center',
                  }}>{convo.unreadCount}</span>
                )}
              </div>

              {/* Reply input area */}
              {isReplyOpen && (
                <div style={{
                  padding: '12px 16px 12px 56px', background: '#f9fafb',
                  borderLeft: `3px solid ${activeTabInfo.color}`,
                  border: '1px solid #e5e7eb', borderTop: 'none',
                  display: 'flex', gap: '8px', alignItems: 'flex-end',
                  borderRadius: isExpanded ? '0' : '0 0 8px 8px',
                }}>
                  <textarea
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder={`Reply to ${convo.contactName}...`}
                    rows={2}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: '8px',
                      border: '1px solid #d1d5db', fontSize: '13px',
                      resize: 'vertical', fontFamily: 'inherit', outline: 'none',
                    }}
                    onFocus={e => { e.target.style.borderColor = activeTabInfo.color; }}
                    onBlur={e => { e.target.style.borderColor = '#d1d5db'; }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSendReply();
                    }}
                  />
                  <button
                    onClick={handleSendReply}
                    disabled={sending || !replyText.trim()}
                    style={{
                      padding: '8px 20px', background: activeTabInfo.color, color: '#fff',
                      border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                      cursor: sending || !replyText.trim() ? 'not-allowed' : 'pointer',
                      opacity: sending || !replyText.trim() ? 0.5 : 1, whiteSpace: 'nowrap',
                    }}
                  >{sending ? 'Sending...' : 'Send SMS'}</button>
                </div>
              )}

              {/* Thread expansion */}
              {isExpanded && (
                <div style={{
                  border: '1px solid #e5e7eb', borderTop: 'none',
                  borderRadius: '0 0 8px 8px', background: '#fafafa',
                  padding: '12px 16px 12px 56px',
                }}>
                  {threadLoading ? (
                    <div style={{ color: '#9ca3af', fontSize: '13px', padding: '8px 0' }}>Loading thread...</div>
                  ) : threadMessages.length === 0 ? (
                    <div style={{ color: '#9ca3af', fontSize: '13px', padding: '8px 0' }}>
                      No stored messages yet. Messages will appear here as they come in via webhooks.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {[...threadMessages].reverse().map(msg => {
                        const isOut = msg.direction === 'outbound';
                        return (
                          <div key={msg.id} style={{
                            display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start',
                          }}>
                            <div style={{
                              maxWidth: '75%', padding: '8px 12px', borderRadius: '12px',
                              background: isOut ? activeTabInfo.color : '#e5e7eb',
                              color: isOut ? '#fff' : '#111827',
                              fontSize: '13px', lineHeight: '1.4',
                            }}>
                              {msg.body && <div>{msg.body}</div>}
                              <div style={{
                                fontSize: '10px', marginTop: '4px',
                                color: isOut ? 'rgba(255,255,255,0.7)' : '#9ca3af',
                                textAlign: 'right',
                              }}>
                                {formatTimestamp(msg.timestamp)}
                                {msg.messageType !== 'SMS' && ` (${msg.messageType.toLowerCase()})`}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Webhook setup notice */}
      <div style={{
        marginTop: '24px', padding: '16px', borderRadius: '8px',
        background: '#fffbeb', border: '1px solid #fde68a',
        fontSize: '13px', color: '#92400e',
      }}>
        <strong>Webhook Setup Required:</strong> To capture full message threads, configure GHL Workflows
        for each sub-account with &ldquo;Customer Replied&rdquo; and &ldquo;Outbound Message&rdquo; triggers
        that POST to the webhook endpoint. Messages sent from this dashboard are automatically stored.
      </div>
    </div>
  );
}
