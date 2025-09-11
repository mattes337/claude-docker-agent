import React from 'react';
import { Plus, Github } from 'lucide-react';
import SessionItem from './SessionItem';
import './Sidebar.css';

const Sidebar = ({ sessions, activeSessionId, onSelectSession, onCreateSession }) => {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <button className="new-session-btn" onClick={onCreateSession}>
          <Plus size={16} />
          New Session
        </button>
      </div>
      
      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="empty-sessions">
            <Github size={48} className="empty-icon" />
            <p>No sessions yet</p>
            <span>Create your first session to get started</span>
          </div>
        ) : (
          sessions.map(session => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onClick={() => onSelectSession(session.id)}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default Sidebar;
