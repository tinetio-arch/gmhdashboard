'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface DropdownItem {
    label: string;
    href: string;
}

interface NavDropdownProps {
    label: string;
    items: DropdownItem[];
}

export default function NavDropdown({ label, items }: NavDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const pathname = usePathname();

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const isActive = items.some(item => pathname.startsWith(item.href));

    return (
        <div
            ref={dropdownRef}
            style={{ position: 'relative', display: 'inline-block' }}
            onMouseEnter={() => setIsOpen(true)}
            onMouseLeave={() => setIsOpen(false)}
        >
            <button
                style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    font: 'inherit',
                    cursor: 'pointer',
                    color: isActive || isOpen ? '#0369a1' : '#000000', // Matches existing link styles roughly (black per layout?) Layout uses default (blueish usually or black)
                    fontWeight: isActive ? 600 : 400,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem'
                }}
                onClick={() => setIsOpen(!isOpen)}
            >
                {label}
                <span style={{ fontSize: '0.7em', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
            </button>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    backgroundColor: 'white',
                    minWidth: '200px',
                    boxShadow: '0 8px 16px rgba(0,0,0,0.1)',
                    borderRadius: '0.5rem',
                    padding: '0.5rem 0',
                    zIndex: 1000,
                    border: '1px solid rgba(148, 163, 184, 0.18)'
                }}>
                    {items.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            style={{
                                display: 'block',
                                padding: '0.75rem 1rem',
                                textDecoration: 'none',
                                color: '#475569',
                                fontSize: '0.9rem',
                                transition: 'background-color 0.1s',
                            }}
                            onClick={() => setIsOpen(false)}
                            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                            {item.label}
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
