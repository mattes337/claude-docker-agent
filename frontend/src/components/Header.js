import React from 'react';
import { Bot, Plus, Wifi, WifiOff, LayoutDashboard, Terminal, Container } from 'lucide-react';

const Header = ({ sessionCount, isConnected, onCreateSession, currentView, onViewDashboard, onViewSession, onViewContainers, sessions }) => {
  return (
    <header className="header">
      <div className="header-top">
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
        
        <div className="header-status">
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
      </div>
      
      <div className="header-navigation">
        <div className="view-navigation">
          <button 
            className={`nav-btn ${currentView === 'dashboard' ? 'active' : ''}`}
            onClick={onViewDashboard}
            title="Dashboard"
          >
            <LayoutDashboard size={16} />
            Dashboard
          </button>
          <button 
            className={`nav-btn ${currentView === 'containers' ? 'active' : ''}`}
            onClick={onViewContainers}
            title="Containers"
          >
            <Container size={16} />
            Containers
          </button>
          <button 
            className={`nav-btn ${currentView === 'session' ? 'active' : ''}`}
            onClick={() => {
              // Always show the first session if sessions exist
              if (sessions && sessions.length > 0) {
                onViewSession(sessions[0].id);
              }
            }}
            title="Session View"
          >
            <Terminal size={16} />
            Session
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
