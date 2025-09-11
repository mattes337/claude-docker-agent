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

  const formatOutput = (output, rawOutput) => {
    // If we have raw output (array format), use it for better type detection
    if (rawOutput && Array.isArray(rawOutput)) {
      return rawOutput.map((item, index) => {
        const content = item.data || '';
        const backendType = item.type || 'output';
        
        // Map backend types to display types
        let displayType = 'output';
        if (backendType === 'system') displayType = 'system';
        else if (backendType === 'git') displayType = 'git';
        else if (backendType === 'error') displayType = 'error';
        else if (backendType === 'success') displayType = 'success';
        else if (backendType === 'claude') displayType = 'claude';
        else if (backendType === 'user') displayType = 'command';
        else if (content.includes('Error:') || content.includes('error:')) displayType = 'error';
        else if (content.includes('Warning:') || content.includes('warning:')) displayType = 'warning';
        else if (content.includes('Success:') || content.includes('✓')) displayType = 'success';
        
        return { type: displayType, content: content.trim(), key: index };
      }).filter(line => line.content.length > 0); // Filter out empty lines
    }
    
    // Fallback to string processing
    if (!output) return [];
    
    // If output is an array (from WebSocket), convert to string first
    if (Array.isArray(output)) {
      const outputString = output.map(item => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null) {
          return item.data || item.content || item.message || '';
        }
        return String(item);
      }).join('');
      return outputString.split('\n').map((line, index) => {
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
      }).filter(line => line.content.trim().length > 0);
    }
    
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
    }).filter(line => line.content.trim().length > 0);
  };

  const outputLines = formatOutput(session.output, session.rawOutput);

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
