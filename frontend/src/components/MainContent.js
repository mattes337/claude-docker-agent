import React from 'react';
import Terminal from './Terminal';
import EmptyState from './EmptyState';
import SessionControls from './SessionControls';
import './MainContent.css';

const MainContent = ({ 
  activeSession, 
  onExecuteCommand, 
  onStopSession, 
  onClearSession 
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
      />
      
      <Terminal
        session={activeSession}
        onExecuteCommand={onExecuteCommand}
      />
    </div>
  );
};

export default MainContent;
