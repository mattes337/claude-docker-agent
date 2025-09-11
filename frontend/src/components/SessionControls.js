import React from 'react';
import { Play, Square, Trash2, Github, GitBranch, Clock } from 'lucide-react';

const SessionControls = ({ session, onStopSession, onClearSession }) => {
  const formatUptime = (startTime) => {
    if (!startTime) return 'Unknown';
    const now = new Date();
    const start = new Date(startTime);
    const diff = Math.floor((now - start) / 1000);
    
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
  };

  const getRepoName = (repoUrl) => {
    if (!repoUrl) return null;
    return repoUrl.split('/').pop().replace('.git', '');
  };

  return (
    <div className="session-controls">
      <div className="session-info">
        <div className="session-title">
          <Play size={18} />
          {session.name}
        </div>
        <div className="session-details">
          {session.repoUrl && (
            <div className="session-detail">
              <Github size={14} />
              {getRepoName(session.repoUrl)}
            </div>
          )}
          {session.branch && (
            <div className="session-detail">
              <GitBranch size={14} />
              {session.branch}
            </div>
          )}
          <div className="session-detail">
            <Clock size={14} />
            {formatUptime(session.startTime)}
          </div>
        </div>
      </div>
      
      <div className="control-buttons">
        <button 
          className="control-btn"
          onClick={onClearSession}
          title="Clear terminal output"
        >
          <Trash2 size={14} />
          Clear
        </button>
        
        <button 
          className="control-btn danger"
          onClick={onStopSession}
          disabled={session.status === 'stopped'}
          title="Stop session"
        >
          <Square size={14} />
          Stop Session
        </button>
      </div>
    </div>
  );
};

export default SessionControls;
