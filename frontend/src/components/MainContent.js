import React from 'react';
import EmptyState from './EmptyState';
import SessionControls from './SessionControls';
import ClaudeTerminal from './ClaudeTerminal';
import './MainContent.css';

const MainContent = ({ 
  activeSession, 
  onStopSession, 
  onClearSession,
  onDeleteSession
}) => {
  if (!activeSession) {
    return <EmptyState />;
  }

  return (
    <div className="main-content">
      <SessionControls
        session={activeSession}
        onStopSession={onStopSession}
        onClearSession={onClearSession}
        onDeleteSession={onDeleteSession}
      />
      
      <ClaudeTerminal
        sessionId={activeSession.id}
        sessionName={activeSession.name}
      />
    </div>
  );
};

export default MainContent;
