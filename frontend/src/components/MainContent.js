import React from 'react';
import Terminal from './Terminal';
import EmptyState from './EmptyState';
import SessionControls from './SessionControls';
import './MainContent.css';

const MainContent = ({ 
  activeSession, 
  onExecuteCommand, 
  onStopSession, 
  onClearSession,
  onDeleteSession,
  onTerminateProcess
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
      
      <Terminal
        session={activeSession}
        onExecuteCommand={onExecuteCommand}
        onTerminateProcess={onTerminateProcess}
      />
    </div>
  );
};

export default MainContent;
