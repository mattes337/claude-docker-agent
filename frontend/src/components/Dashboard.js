import React from 'react';
import { CheckCircle, AlertCircle, Loader, MoreHorizontal, Eye } from 'lucide-react';
import clsx from 'clsx';
import './Dashboard.css';

const Dashboard = ({ sessions, onSelectSession }) => {
  const getStatusInfo = (status, state) => {
    const currentState = state || status;
    
    switch (currentState) {
      case 'waiting_input':
        return {
          color: '#f59e0b',
          bgColor: '#fef3c7',
          icon: AlertCircle,
          text: 'Waiting for input'
        };
      case 'completed':
        return {
          color: '#10b981',
          bgColor: '#d1fae5',
          icon: CheckCircle,
          text: 'Completed'
        };
      case 'processing':
        return {
          color: '#3b82f6',
          bgColor: '#dbeafe',
          icon: Loader,
          text: 'Processing'
        };
      case 'waiting_limited':
      case 'waiting':
        return {
          color: '#6b7280',
          bgColor: '#f3f4f6',
          icon: MoreHorizontal,
          text: 'Waiting'
        };
      case 'running':
        return {
          color: '#10b981',
          bgColor: '#d1fae5',
          icon: CheckCircle,
          text: 'Running'
        };
      case 'initializing':
        return {
          color: '#3b82f6',
          bgColor: '#dbeafe',
          icon: Loader,
          text: 'Initializing'
        };
      case 'stopped':
        return {
          color: '#6b7280',
          bgColor: '#f3f4f6',
          icon: null,
          text: 'Stopped'
        };
      case 'error':
        return {
          color: '#ef4444',
          bgColor: '#fee2e2',
          icon: AlertCircle,
          text: 'Error'
        };
      default:
        return {
          color: '#6b7280',
          bgColor: '#f3f4f6',
          icon: null,
          text: status
        };
    }
  };

  const getProgressPercentage = (session) => {
    // Simple progress calculation based on state
    switch (session.state || session.status) {
      case 'initializing':
        return 25;
      case 'running':
      case 'waiting_input':
        return 75;
      case 'processing':
        return 50;
      case 'completed':
        return 100;
      case 'error':
        return 0;
      default:
        return 10;
    }
  };

  if (sessions.length === 0) {
    return (
      <div className="dashboard-empty">
        <div className="empty-state">
          <h3>No Sessions</h3>
          <p>Create your first session to see the dashboard</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Session Dashboard</h2>
        <p>Monitor all your active sessions</p>
      </div>

      <div className="dashboard-grid">
        {sessions.map(session => {
          const statusInfo = getStatusInfo(session.status, session.state);
          const progress = getProgressPercentage(session);
          const IconComponent = statusInfo.icon;

          return (
            <div 
              key={session.id} 
              className="session-card"
              onClick={() => onSelectSession(session.id)}
            >
              <div className="session-card-header">
                <h4 className="session-card-name">{session.name}</h4>
                <button className="view-logs-btn" title="View Logs">
                  <Eye size={14} />
                </button>
              </div>

              <div className="progress-circle-container">
                <div 
                  className="progress-circle"
                  style={{ 
                    '--progress': `${progress}%`,
                    '--color': statusInfo.color,
                    '--bg-color': statusInfo.bgColor
                  }}
                >
                  <div className="progress-circle-inner">
                    {IconComponent && (
                      <IconComponent 
                        size={20} 
                        className={clsx(
                          'progress-icon',
                          {
                            'spinning': statusInfo.text === 'Processing' || statusInfo.text === 'Initializing',
                            'pulsing': statusInfo.text === 'Waiting for input'
                          }
                        )}
                        style={{ color: statusInfo.color }}
                      />
                    )}
                  </div>
                  <svg className="progress-ring" width="80" height="80">
                    <circle
                      className="progress-ring-bg"
                      cx="40"
                      cy="40"
                      r="36"
                    />
                    <circle
                      className="progress-ring-progress"
                      cx="40"
                      cy="40"
                      r="36"
                      style={{ 
                        stroke: statusInfo.color,
                        strokeDasharray: `${2 * Math.PI * 36}`,
                        strokeDashoffset: `${2 * Math.PI * 36 * (1 - progress / 100)}`
                      }}
                    />
                  </svg>
                </div>
              </div>

              <div className="session-card-status">
                <span className="status-text" style={{ color: statusInfo.color }}>
                  {statusInfo.text}
                </span>
                <span className="progress-text">{progress}%</span>
              </div>

              {session.repoUrl && (
                <div className="session-card-repo">
                  {session.repoUrl.split('/').pop().replace('.git', '')}
                </div>
              )}

              {session.currentBranch && (
                <div className="session-card-branch">
                  Branch: {session.currentBranch}
                </div>
              )}

              <div className="session-card-time">
                {new Date(session.createdAt).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Dashboard;