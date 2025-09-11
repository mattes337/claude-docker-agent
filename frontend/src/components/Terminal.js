import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader } from 'lucide-react';
import './Terminal.css';

const Terminal = ({ session, onExecuteCommand }) => {
  const [input, setInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const outputRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [session.output]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isExecuting) return;

    const command = input.trim();
    setInput('');
    setIsExecuting(true);

    try {
      await onExecuteCommand(command);
    } catch (error) {
      console.error('Command execution failed:', error);
    } finally {
      setIsExecuting(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const formatOutput = (output) => {
    if (!output) return [];
    
    return output.split('\n').map((line, index) => {
      // Detect different types of output
      if (line.startsWith('$ ') || line.startsWith('> ')) {
        return { type: 'command', content: line, key: index };
      } else if (line.includes('Error:') || line.includes('error:')) {
        return { type: 'error', content: line, key: index };
      } else if (line.includes('Warning:') || line.includes('warning:')) {
        return { type: 'warning', content: line, key: index };
      } else if (line.includes('Success:') || line.includes('✓')) {
        return { type: 'success', content: line, key: index };
      } else {
        return { type: 'output', content: line, key: index };
      }
    });
  };

  const outputLines = formatOutput(session.output);

  return (
    <div className="terminal">
      <div className="terminal-header">
        <div className="terminal-title">
          <div className="terminal-dots">
            <span className="dot red"></span>
            <span className="dot yellow"></span>
            <span className="dot green"></span>
          </div>
          <span>Claude Session Terminal</span>
        </div>
        <div className="terminal-status">
          {session.status === 'running' && (
            <span className="status-indicator running">
              <span className="status-dot"></span>
              Running
            </span>
          )}
          {session.status === 'initializing' && (
            <span className="status-indicator initializing">
              <Loader size={14} className="spinning" />
              Initializing
            </span>
          )}
        </div>
      </div>
      
      <div className="terminal-output" ref={outputRef}>
        {outputLines.length === 0 ? (
          <div className="terminal-welcome">
            <p>🤖 Claude session ready!</p>
            <p>Type your commands below to interact with Claude in this containerized environment.</p>
          </div>
        ) : (
          outputLines.map((line) => (
            <div key={line.key} className={`output-line ${line.type}`}>
              {line.content}
            </div>
          ))
        )}
        {isExecuting && (
          <div className="output-line executing">
            <Loader size={14} className="spinning" />
            Executing command...
          </div>
        )}
      </div>
      
      <form className="terminal-input" onSubmit={handleSubmit}>
        <div className="input-wrapper">
          <span className="prompt">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your command for Claude..."
            disabled={isExecuting || session.status !== 'running'}
            autoFocus
          />
          <button 
            type="submit" 
            disabled={!input.trim() || isExecuting || session.status !== 'running'}
            className="send-btn"
          >
            {isExecuting ? (
              <Loader size={16} className="spinning" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default Terminal;
