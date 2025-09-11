import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import MainContent from './components/MainContent';
import Dashboard from './components/Dashboard';
import Containers from './components/Containers';
import CreateSessionModal from './components/CreateSessionModal';
import { useWebSocket } from './hooks/useWebSocket';
import { useSessionManager } from './hooks/useSessionManager';
import './App.css';
import './components/Containers.css';

function App() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [currentView, setCurrentView] = useState('dashboard'); // 'dashboard', 'session', or 'containers'
  
  const {
    sessions,
    createSession,
    stopSession,
    executeCommand,
    clearSession,
    loadSessions,
    updateSession,
    appendSessionOutput,
    loadContainers,
    removeContainer
  } = useSessionManager();
  
  const { isConnected } = useWebSocket(sessions, activeSessionId, updateSession, appendSessionOutput);

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
    setCurrentView('session');
  };

  const handleViewDashboard = () => {
    setCurrentView('dashboard');
    setActiveSessionId(null);
  };

  const handleViewContainers = () => {
    setCurrentView('containers');
    setActiveSessionId(null);
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

  const handleDeleteSession = async (sessionId) => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        // Remove session from local state
        const newSessions = new Map(sessions);
        newSessions.delete(sessionId);
        
        // If deleted session was active, clear active session
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
          setCurrentView('dashboard');
        }
        
        // Reload sessions to get updated state
        loadSessions();
      } else {
        const result = await response.json();
        alert('Failed to delete session: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      alert('Failed to delete session: ' + error.message);
    }
  };

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null;

  const handleViewSession = () => {
    if (activeSessionId) {
      setCurrentView('session');
    }
  };

  return (
    <div className="app">
      <Header 
        sessionCount={sessions.size}
        isConnected={isConnected}
        onCreateSession={() => setShowCreateModal(true)}
        currentView={currentView}
        onViewDashboard={handleViewDashboard}
        onViewSession={handleViewSession}
        onViewContainers={handleViewContainers}
        hasActiveSession={!!activeSessionId}
      />
      
      {currentView === 'dashboard' ? (
        <Dashboard 
          sessions={Array.from(sessions.values())}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
        />
      ) : currentView === 'containers' ? (
        <Containers 
          loadContainers={loadContainers}
          removeContainer={removeContainer}
        />
      ) : (
        <div className="app-main">
          <Sidebar
            sessions={Array.from(sessions.values())}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onCreateSession={() => setShowCreateModal(true)}
            onDeleteSession={handleDeleteSession}
          />
          
          <MainContent
            activeSession={activeSession}
            onExecuteCommand={handleExecuteCommand}
            onStopSession={handleStopSession}
            onClearSession={handleClearSession}
          />
        </div>
      )}

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
