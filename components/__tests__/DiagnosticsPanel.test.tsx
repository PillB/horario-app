/* eslint-disable import/first */
// QA U8: the log list rendered a <ul> with no <li> children on web. The list
// role must sit on the element whose direct children are the list items.

jest.mock('@/hooks/useColorScheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/useAuditLog', () => ({ useAuditLog: jest.fn() }));

import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { DiagnosticsPanel } from '@/components/DiagnosticsPanel';
import { useAuditLog } from '@/hooks/useAuditLog';

const mockUseAuditLog = useAuditLog as jest.Mock;

function renderPanel(entries: unknown[]): ReactTestRenderer {
  mockUseAuditLog.mockReturnValue({
    entries,
    copyToClipboard: jest.fn(),
    clear: jest.fn(),
    refresh: jest.fn(),
    lastRefreshedAt: null,
  });
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(<DiagnosticsPanel />);
  });
  return tree as ReactTestRenderer;
}

const ENTRIES = [
  { timestamp: '2026-10-20T10:00:00.000Z', level: 'INFO', category: 'sync', message: 'Saved' },
  { timestamp: '2026-10-20T10:01:00.000Z', level: 'ERROR', category: 'api', message: 'Failed' },
];

describe('DiagnosticsPanel', () => {
  it('renders entries as list items directly inside the list', () => {
    const tree = renderPanel(ENTRIES);
    // The host element (what react-native-web turns into <ul>).
    const [list] = tree.root.findAll(
      (node) => node.props.testID === 'log-entries-list' && typeof node.type === 'string',
    );
    expect(list.props.role).toBe('list');
    const items = list.children.filter(
      (child): child is renderer.ReactTestInstance => typeof child !== 'string',
    );
    expect(items).toHaveLength(2);
    for (const item of items) {
      // EntryRow's root View carries the listitem role.
      expect(item.findByProps({ role: 'listitem' })).toBeTruthy();
    }
    // Newest first.
    expect(JSON.stringify(items[0].props)).toContain('Failed');
  });

  it('shows the empty message without an empty list', () => {
    const tree = renderPanel([]);
    expect(tree.root.findAll((node) => node.props.testID === 'log-entries-list')).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain('No log entries yet');
  });

  it('gives every action button a label and a hint', () => {
    const tree = renderPanel(ENTRIES);
    const buttons = tree.root.findAll(
      (node) => node.props.accessibilityRole === 'button' && typeof node.type !== 'string',
    );
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const button of buttons) {
      expect(button.props.accessibilityLabel).toBeTruthy();
      expect(button.props.accessibilityHint).toBeTruthy();
    }
  });
});
