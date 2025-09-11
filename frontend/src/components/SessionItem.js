import React from 'react';
import { Github, GitBranch, CheckCircle, AlertCircle, Loader, MoreHorizontal } from 'lucide-react';
import clsx from 'clsx';

const SessionItem = ({ session, isActive, onClick }) => {
  const getRepoName = (repoUrl) => {
    if (!repoUrl) return 'No Repository';
    return repoUrl.split('/').pop().replace('.git', '');
  };

  const getStatusInfo = (status, state) => {
    // Priority: state over status for more specific indicators
    const currentState = state || status;
    
    switch (currentState) {
      case 'waiting_input':
        return {
          icon: <AlertCircle size={14} className="status-icon pulsing" />,
          color: 'waiting-input',
          text: 'Waiting for input'
        };
      case 'completed':
        return {
          icon: <CheckCircle size={14} className="status-icon" />,
          color: 'completed',
          text: 'Completed'
        };
      case 'processing':
        return {
          icon: <Loader size={14} className="status-icon spinning" />,
          color: 'processing',
          text: 'Processing'
        };
      case 'waiting_limited':
      case 'waiting':
        return {
          icon: <MoreHorizontal size={14} className="status-icon pulsing-dots" />,
          color: 'waiting',
          text: 'Waiting'
        };
      case 'running':
        return {
          icon: <CheckCircle size={14} className="status-icon" />,
          color: 'running',
          text: 'Running'
        };
      case 'initializing':
        return {
          icon: <Loader size={14} className="status-icon spinning" />,
          color: 'initializing',
          text: 'Initializing'
        };
      case 'stopped':
        return {
          icon: <div className="status-dot stopped"></div>,
          color: 'stopped',
          text: 'Stopped'
        };
      case 'error':
        return {
          icon: <AlertCircle size={14} className="status-icon" />,
          color: 'error',
          text: 'Error'
        };
      default:
        return {
          icon: <div className="status-dot"></div>,
          color: '',
          text: status
        };
    }
  };

  return (
    <div 
      className={clsx('session-item', { active: isActive })}
      onClick={onClick}
    >
      <div className="session-name">
        <span>{session.name}</span>
      </div>
      
      {session.repoUrl && (
        <div className="session-repo">
          <Github size={14} />
          {getRepoName(session.repoUrl)}
        </div>
      )}
      
      {session.branch && (
        <div className="session-branch">
          <GitBranch size={14} />
          {session.branch}
        </div>
      )}
      
      <div className="session-status">
        {(() => {
          const statusInfo = getStatusInfo(session.status, session.state);
          return (
            <>
              <span className={clsx('status-indicator', statusInfo.color)}>
                {statusInfo.icon}
              </span>
              <span className="status-text">{statusInfo.text}</span>
            </>
          );
        })()}
      </div>
    </div>
  );
};

export default SessionItem;
