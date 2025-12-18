"use client";

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    HeidiWidget?: {
      create(options: HeidiWidgetOptions): HeidiWidgetInstance;
    };
  }
}

type HeidiWidgetOptions = {
  container: HTMLElement;
  token: string;
  patient: {
    id: string;
    name: string;
    dob?: string;
  };
  templateId?: string;
  notesEnabled?: boolean;
  onNoteReady?: (payload: { note: string; format: string }) => void;
};

type HeidiWidgetInstance = {
  destroy(): void;
};

export type HeidiWidgetProps = {
  token: string;
  patient: { id: string; name: string; dob?: string };
  templateId?: string;
  notesEnabled?: boolean;
  onNoteReady?: (payload: { note: string; format: string }) => void;
};

const DEFAULT_WIDGET_URL =
  process.env.NEXT_PUBLIC_HEIDI_WIDGET_URL ?? 'https://widget.heidihealth.com/sdk.js';
const SCRIPT_ID = 'heidi-widget-sdk';

export function HeidiWidget({ token, patient, templateId, notesEnabled = true, onNoteReady }: HeidiWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<HeidiWidgetInstance | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }

    if (document.getElementById(SCRIPT_ID)) {
      setScriptLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = DEFAULT_WIDGET_URL;
    script.async = true;
    script.onload = () => setScriptLoaded(true);
    script.onerror = () => console.error('[Heidi] Failed to load widget script');
    document.body.appendChild(script);

    return () => {
      if (widgetRef.current) {
        widgetRef.current.destroy();
        widgetRef.current = null;
      }
    };
  }, [token]);

  useEffect(() => {
    if (!scriptLoaded || !token || !window.HeidiWidget || !containerRef.current) {
      return;
    }

    if (widgetRef.current) {
      widgetRef.current.destroy();
      widgetRef.current = null;
    }

    widgetRef.current = window.HeidiWidget.create({
      container: containerRef.current,
      token,
      patient,
      templateId,
      notesEnabled,
      onNoteReady,
    });

    return () => {
      if (widgetRef.current) {
        widgetRef.current.destroy();
        widgetRef.current = null;
      }
    };
  }, [scriptLoaded, token, patient.id, patient.name, templateId, notesEnabled, onNoteReady]);

  if (!token) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">
        Heidi widget unavailable: missing token.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="heidi-widget-container rounded-lg border border-gray-200 bg-white"
      style={{ minHeight: 420 }}
    />
  );
}


