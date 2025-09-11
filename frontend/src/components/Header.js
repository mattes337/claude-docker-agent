import React from 'react';
import { Bot, Plus, Wifi, WifiOff } from 'lucide-react';

const Header = ({ sessionCount, isConnected, onCreateSession }) => {
  return (
    <header className="header">
      <div className="header-content">
        <h1>
          <Bot size={28} />
          Claude Docker Agent
          <span className="session-counter">
            {sessionCount} session{sessionCount !== 1 ? 's' : ''}
          </span>
        </h1>
        <div className="header-info">
          Manage multiple Claude Code sessions in isolated Docker containers
        </div>
      </div>
      
      <div className="header-actions">
        <div className="connection-status">
          {isConnected ? (
            <>
              <div className="connection-dot connected"></div>
              <Wifi size={16} />
              Connected
            </>
          ) : (
            <>
              <div className="connection-dot"></div>
              <WifiOff size={16} />
              Disconnected
            </>
          )}
        </div>
        
        <button className="btn primary" onClick={onCreateSession}>
          <Plus size={16} />
          New Session
        </button>
      </div>
    </header>
  );
};

export default Header;
