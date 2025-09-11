import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import MainContent from './components/MainContent';
import CreateSessionModal from './components/CreateSessionModal';
import { useWebSocket } from './hooks/useWebSocket';
import { useSessionManager } from './hooks/useSessionManager';
import './App.css';

function App() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);
  
  const {
    sessions,
    createSession,
    stopSession,
    executeCommand,
    clearSession,
    loadSessions
  } = useSessionManager();
  
  const { isConnected } = useWebSocket(sessions, activeSessionId);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleCreateSession = async (sessionData) => {
    const result = await createSession(sessionData);
    if (result.success) {
      setShowCreateModal(false);
      // Auto-select the new session when it's ready
      if (result.session) {
        setActiveSessionId(result.session.id);
      }
    }
    return result;
  };

  const handleSelectSession = (sessionId) => {
    setActiveSessionId(sessionId);
  };

  const handleStopSession = async () => {
    if (activeSessionId) {
      await stopSession(activeSessionId);
    }
  };

  const handleExecuteCommand = async (command) => {
    if (activeSessionId) {
      return await executeCommand(activeSessionId, command);
    }
    return { success: false, error: 'No active session' };
  };

  const handleClearSession = async () => {
    if (activeSessionId) {
      await clearSession(activeSessionId);
    }
  };

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null;

  return (
    <div className="app">
      <Header 
        sessionCount={sessions.size}
        isConnected={isConnected}
        onCreateSession={() => setShowCreateModal(true)}
      />
      
      <div className="app-main">
        <Sidebar
          sessions={Array.from(sessions.values())}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onCreateSession={() => setShowCreateModal(true)}
        />
        
        <MainContent
          activeSession={activeSession}
          onExecuteCommand={handleExecuteCommand}
          onStopSession={handleStopSession}
          onClearSession={handleClearSession}
        />
      </div>

      {showCreateModal && (
        <CreateSessionModal
          onClose={() => setShowCreateModal(false)}
          onCreateSession={handleCreateSession}
        />
      )}
    </div>
  );
}

export default App;
