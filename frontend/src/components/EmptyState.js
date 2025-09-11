import React from 'react';
import { Bot, Plus } from 'lucide-react';

const EmptyState = () => {
  return (
    <div className="empty-state">
      <Bot size={80} className="empty-state-icon" />
      <h2>No Session Selected</h2>
      <p>
        Select an existing session from the sidebar or create a new one to start 
        working with Claude in an isolated Docker environment.
      </p>
      <button className="btn">
        <Plus size={16} />
        Create New Session
      </button>
    </div>
  );
};

export default EmptyState;
