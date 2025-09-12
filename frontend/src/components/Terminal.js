import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Loader, Square } from 'lucide-react';
import ansiRenderer from '../utils/ansiRenderer';
import LLMMessage from './LLMMessage';
import './Terminal.css';

const Terminal = ({ session, onExecuteCommand, onTerminateProcess }) => {
  const [input, setInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  // Screen replacement mode state
  const [screenMode, setScreenMode] = useState('append'); // 'append' or 'replace'
  const [screenBuffer, setScreenBuffer] = useState([]);
  const [isClaudeRunning, setIsClaudeRunning] = useState(false);
  const outputRef = useRef(null);
  const inputRef = useRef(null);
  const lastOutputRef = useRef(''); // Track last output for change detection

  // Detect Claude running state and screen clearing sequences
  const detectClaudeState = useMemo(() => {
    if (!session.output && !session.rawOutput) return { isClaudeRunning: false, hasScreenClear: false };
    
    const output = session.output || '';
    const rawOutput = session.rawOutput || [];
    
    // Check if Claude is running - specifically look for Claude Code interactive interface
    const claudeRunning = output.includes('Welcome to Claude Code') ||
                         output.includes('Choose the text style that looks best') ||
                         rawOutput.some(item => 
                           item.type === 'claude' || 
                           (typeof item.data === 'string' && (
                             item.data.includes('Welcome to Claude Code') ||
                             item.data.includes('Choose the text style that looks best')
                           ))
                         );
    
    // Enhanced screen clearing detection - look for the specific patterns that indicate screen replacement
    // eslint-disable-next-line no-control-regex
    const screenClearPatterns = [
      /\x1b\[2J/,     // Clear entire screen
      /\x1b\[H/,      // Move cursor to home
      /\x1b\[1;1H/,   // Move cursor to position 1,1
      /\x1b\[\?2026[hl]/, // Application mode sequences that cause screen replacement
    ];
    
    const hasScreenClear = screenClearPatterns.some(pattern => pattern.test(output)) ||
                          rawOutput.some(item => 
                            typeof item.data === 'string' && 
                            screenClearPatterns.some(pattern => pattern.test(item.data))
                          ) ||
                          // Also detect when we have repeating Claude welcome screens (indicates screen replacement)
                          (output.match(/Welcome to Claude Code/g) || []).length > 1;
    
    return { isClaudeRunning: claudeRunning, hasScreenClear };
  }, [session.output, session.rawOutput]);
  
  // Update Claude running state with smooth transitions
  useEffect(() => {
    const { isClaudeRunning: newClaudeState } = detectClaudeState;
    if (newClaudeState !== isClaudeRunning) {
      setIsClaudeRunning(newClaudeState);
      // Switch to replace mode when Claude starts running
      if (newClaudeState) {
        setScreenMode('replace');
      } else {
        // Delay switching back to append mode to avoid flickering
        setTimeout(() => {
          setScreenMode('append');
        }, 2000);
      }
    }
  }, [detectClaudeState, isClaudeRunning]);
  
  // Handle screen buffer updates with improved replacement logic
  useEffect(() => {
    if (!session.output && !session.rawOutput) {
      setScreenBuffer([]);
      return;
    }
    
    const { hasScreenClear, isClaudeRunning } = detectClaudeState;
    const currentOutput = session.output || '';
    
    // Only update if output has actually changed to prevent unnecessary re-renders
    if (currentOutput === lastOutputRef.current) {
      return;
    }
    
    // When Claude is running, we want to mirror the screen exactly
    if (isClaudeRunning) {
      // Extract the latest screen state by looking at the most recent complete screen
      let screenContent = currentOutput;
      
      // If we detect screen clearing or repeated welcome screens, extract the latest screen
      if (hasScreenClear || (currentOutput.match(/Welcome to Claude Code/g) || []).length > 1) {
        // Find the last occurrence of the welcome screen to get the latest state
        const welcomeScreens = currentOutput.split('Welcome to Claude Code');
        if (welcomeScreens.length > 1) {
          // Take the last screen content
          screenContent = 'Welcome to Claude Code' + welcomeScreens[welcomeScreens.length - 1];
        }
      }
      
      // Format and replace the entire buffer with the current screen state
      const newBuffer = formatOutput(screenContent, session.rawOutput);
      setScreenBuffer(newBuffer);
    } else {
      // Normal append mode for non-Claude output
      const newBuffer = formatOutput(currentOutput, session.rawOutput);
      setScreenBuffer(newBuffer);
    }
    
    lastOutputRef.current = currentOutput;
  }, [session.output, session.rawOutput, screenMode, detectClaudeState]);
  
  // Auto-scroll to bottom when new content appears
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [screenBuffer]);
  
  // Reset screen mode when session changes
  useEffect(() => {
    if (session?.id) {
      setScreenMode('append');
      setIsClaudeRunning(false);
      setScreenBuffer([]);
      lastOutputRef.current = '';
    }
  }, [session?.id]);

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

  const handleTerminate = async () => {
    if (onTerminateProcess) {
      try {
        await onTerminateProcess(false); // graceful termination
        setIsExecuting(false);
      } catch (error) {
        console.error('Failed to terminate process:', error);
      }
    }
  };

  const formatOutput = (output, rawOutput) => {
    console.log('formatOutput called with:', {
      outputLength: output?.length || 0,
      rawOutputLength: rawOutput?.length || 0,
      firstRawItem: rawOutput?.[0],
      outputSample: output?.substring(0, 200)
    });
    // Process ANSI escape sequences for proper web display instead of removing them
    const processANSI = (text) => {
      if (typeof text !== 'string') return { clean: text, rendered: text };
      // Backend already cleaned most sequences, just render remaining color codes
      const rendered = ansiRenderer.render(text);
      // Also provide cleaned version for content detection
      const clean = text
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[\?[0-9]+[hl]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      return { clean, rendered };
    };
    
    // If we have raw output (array format), use it for better type detection
    if (rawOutput && Array.isArray(rawOutput)) {
      return rawOutput.map((item, index) => {
        const processed = processANSI(item.data || '');
        const content = processed.clean;
        const renderedContent = processed.rendered;
        const backendType = item.type || 'output';
        
        console.log('Processing rawOutput item:', {
          index,
          backendType,
          contentLength: content.length,
          contentPreview: content.substring(0, 50),
          hasData: !!item.data
        });
        
        // Map backend types to display types
        let displayType = 'output';
        if (backendType === 'system') displayType = 'system';
        else if (backendType === 'git') displayType = 'git';
        else if (backendType === 'error') displayType = 'error';
        else if (backendType === 'success') displayType = 'success';
        else if (backendType === 'claude') displayType = 'claude';
        else if (backendType === 'claude_message_start') displayType = 'claude-message-start';
        else if (backendType === 'claude_message_delta') displayType = 'claude-message-delta';
        else if (backendType === 'claude_message_end') displayType = 'claude-message-end';
        else if (backendType === 'claude_tool') displayType = 'claude-tool';
        else if (backendType === 'claude_tool_result') displayType = 'claude-tool-result';
        else if (backendType === 'claude_status') displayType = 'claude-status';
        else if (backendType === 'claude_raw') displayType = 'claude-raw';
        else if (backendType === 'welcome') displayType = 'welcome';
        else if (backendType === 'user') displayType = 'user';
        else if (content.includes('Error:') || content.includes('error:')) displayType = 'error';
        else if (content.includes('Warning:') || content.includes('warning:')) displayType = 'warning';
        else if (content.includes('Success:') || content.includes('✓')) displayType = 'success';
        
        console.log('Mapped to displayType:', displayType);
        
        return { 
          type: displayType, 
          content: content.trim(), 
          renderedContent: renderedContent, // Already processed by processANSI
          key: index 
        };
      }).filter(line => {
        // Filter out empty lines and system initialization messages for chat interface
        if (line.content.length === 0) return false;
        
        // Hide system setup messages that aren't relevant for chat
        const hideTypes = ['system', 'git'];
        if (hideTypes.includes(line.type)) {
          // But keep important system messages (errors, warnings, etc.)
          const keepPatterns = ['error', 'warning', 'failed', 'terminated', 'completed', 'stopped'];
          const shouldKeep = keepPatterns.some(pattern => 
            line.content.toLowerCase().includes(pattern)
          );
          return shouldKeep;
        }
        
        return true;
      });
    }
    
    // Fallback to string processing
    if (!output) return [];
    
    // Process the output for ANSI rendering
    const processedOutput = processANSI(output);
    const cleanedOutput = processedOutput.clean;
    const renderedOutput = processedOutput.rendered;
    
    // If output is an array (from WebSocket), convert to string first
    if (Array.isArray(output)) {
      const outputString = output.map(item => {
        if (typeof item === 'string') return processANSI(item);
        if (typeof item === 'object' && item !== null) {
          return processANSI(item.data || item.content || item.message || '');
        }
        return processANSI(String(item));
      });
      
      const cleanString = outputString.map(p => p.clean).join('');
      const renderedString = outputString.map(p => p.rendered).join('');
      
      return cleanString.split('\n').map((line, index) => {
        const renderedLine = renderedString.split('\n')[index] || line;
        // Detect different types of output
        let type = 'output';
        if (line.startsWith('$ ') || line.startsWith('> ')) {
          type = 'command';
        } else if (line.includes('Error:') || line.includes('error:')) {
          type = 'error';
        } else if (line.includes('Warning:') || line.includes('warning:')) {
          type = 'warning';
        } else if (line.includes('Success:') || line.includes('✓')) {
          type = 'success';
        }
        
        return { 
          type, 
          content: line, 
          renderedContent: renderedLine, // Already processed by processANSI
          key: index 
        };
      }).filter(line => line.content.trim().length > 0);
    }
    
    return cleanedOutput.split('\n').map((line, index) => {
      const renderedLine = renderedOutput.split('\n')[index] || line;
      // Detect different types of output
      let type = 'output';
      if (line.startsWith('$ ') || line.startsWith('> ')) {
        type = 'command';
      } else if (line.includes('Error:') || line.includes('error:')) {
        type = 'error';
      } else if (line.includes('Warning:') || line.includes('warning:')) {
        type = 'warning';
      } else if (line.includes('Success:') || line.includes('✓')) {
        type = 'success';
      }
      
      return { 
        type, 
        content: line, 
        renderedContent: renderedLine, // Already processed by processANSI
        key: index 
      };
    }).filter(line => line.content.trim().length > 0);
  };

  // Use screen buffer for rendering instead of direct formatting
  const outputLines = screenBuffer;

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
          {isClaudeRunning && screenMode === 'replace' && (
            <span className="status-indicator claude-mode">
              🤖 Claude Mode
            </span>
          )}
          {isExecuting && (
            <button 
              onClick={handleTerminate}
              className="terminate-btn"
              title="Terminate running process"
            >
              <Square size={14} />
              Stop
            </button>
          )}
        </div>
      </div>
      
      <div 
        className={`terminal-output ${screenMode === 'replace' ? 'claude-mode' : ''}`}
        ref={outputRef}
      >
        {outputLines.length === 0 ? (
          <div className="terminal-startup">
            {session.status === 'initializing' && (
              <div className="startup-message">
                <span>Starting container and initializing Claude...</span>
              </div>
            )}
          </div>
        ) : (
          outputLines.map((line) => {
            console.log('Terminal rendering line:', {
              key: line.key,
              type: line.type,
              content: line.content?.substring(0, 100) + (line.content?.length > 100 ? '...' : ''),
              hasContent: !!line.content
            });
            
            return (
              <div key={line.key} className={`terminal-line streaming ${line.type}`}>
                {line.type === 'welcome' ? (
                  <div className="welcome-message">
                    <div style={{background: 'yellow', padding: '4px', marginBottom: '4px'}}>
                      DEBUG: Rendering welcome message with LLMMessage
                    </div>
                    <LLMMessage 
                      content={line.content} 
                      isStreaming={false} 
                    />
                  </div>
                ) : line.type.startsWith('claude-message') ? (
                  <div className={`claude-response ${line.type}`}>
                    <div style={{background: 'orange', padding: '4px', marginBottom: '4px'}}>
                      DEBUG: Rendering claude message type: {line.type}
                    </div>
                    {line.type === 'claude-message-start' ? (
                      <div className="claude-message-header">{line.content}</div>
                    ) : line.type === 'claude-message-delta' ? (
                      <div>
                        <div style={{background: 'cyan', padding: '4px', marginBottom: '4px'}}>
                          DEBUG: Calling LLMMessage for claude-message-delta
                        </div>
                        <LLMMessage 
                          content={line.content} 
                          isStreaming={true} 
                        />
                      </div>
                    ) : (
                      <div className="claude-message-end">{line.content}</div>
                    )}
                  </div>
              ) : line.renderedContent ? (
                <div dangerouslySetInnerHTML={{ __html: line.renderedContent }} />
              ) : (
                <div className={`output-line ${line.type}`}>
                  {line.content}
                </div>
              )}
            </div>
            );
          })
        )}
        {isExecuting && (
          <div className="terminal-line">
            <div className="claude-thinking">
              <span>Claude is processing your request...</span>
            </div>
          </div>
        )}
      </div>
      
      <form className="terminal-input" onSubmit={handleSubmit}>
        <div className="input-wrapper">
          <span className="prompt">claude&gt;</span>
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
