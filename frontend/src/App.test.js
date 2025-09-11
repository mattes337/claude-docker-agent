import { render, screen } from '@testing-library/react';
import App from './App';

// Mock the hooks to avoid WebSocket and API calls in tests
jest.mock('./hooks/useWebSocket', () => ({
  useWebSocket: () => ({ isConnected: false })
}));

jest.mock('./hooks/useSessionManager', () => ({
  useSessionManager: () => ({
    sessions: new Map(),
    createSession: jest.fn(),
    stopSession: jest.fn(),
    executeCommand: jest.fn(),
    clearSession: jest.fn(),
    loadSessions: jest.fn()
  })
}));

test('renders Claude Docker Agent header', () => {
  render(<App />);
  const headerElement = screen.getByText(/Claude Docker Agent/i);
  expect(headerElement).toBeInTheDocument();
});

test('renders new session button', () => {
  render(<App />);
  const newSessionButtons = screen.getAllByText(/New Session/i);
  expect(newSessionButtons.length).toBeGreaterThan(0);
});

test('renders empty state when no sessions', () => {
  render(<App />);
  const emptyStateElement = screen.getByText(/No Session Selected/i);
  expect(emptyStateElement).toBeInTheDocument();
});
