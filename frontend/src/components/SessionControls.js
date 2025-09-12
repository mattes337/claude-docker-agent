import React from 'react';
import { Square, Trash2 } from 'lucide-react';

const SessionControls = ({ session, onStopSession, onClearSession, onDeleteSession }) => {
  return (
    <div className="session-controls">
      <div className="control-buttons">
        <button 
          className="control-btn"
          onClick={onClearSession}
          title="Clear terminal output"
        >
          <Trash2 size={14} />
          Clear
        </button>
        
        {session.status === 'stopped' || session.state === 'stopped' ? (
          <button 
            className="control-btn danger"
            onClick={() => {
              if (window.confirm(`Are you sure you want to delete session "${session.name}"? This action cannot be undone.`)) {
                onDeleteSession(session.id);
              }
            }}
            title="Delete session"
          >
            <Trash2 size={14} />
            Delete Session
          </button>
        ) : (
          <button 
            className="control-btn danger"
            onClick={onStopSession}
            title="Stop session"
          >
            <Square size={14} />
            Stop Session
          </button>
        )}
      </div>
    </div>
  );
};

export default SessionControls;
