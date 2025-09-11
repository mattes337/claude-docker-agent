import React from 'react';
import { Github, GitBranch } from 'lucide-react';
import clsx from 'clsx';

const SessionItem = ({ session, isActive, onClick }) => {
  const getRepoName = (repoUrl) => {
    if (!repoUrl) return 'No Repository';
    return repoUrl.split('/').pop().replace('.git', '');
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'running':
        return 'running';
      case 'initializing':
        return 'initializing';
      case 'stopped':
        return 'stopped';
      case 'error':
        return 'error';
      default:
        return '';
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
        <span className={clsx('status-dot', getStatusColor(session.status))}></span>
        {session.status}
        {session.state && session.state !== session.status && (
          <span>• {session.state}</span>
        )}
      </div>
    </div>
  );
};

export default SessionItem;
