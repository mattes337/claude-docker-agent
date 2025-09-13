import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { saveAs } from 'file-saver';
import './ClaudeTerminal.css';

const ClaudeTerminal = ({ sessionId, sessionName }) => {
    const [messages, setMessages] = useState([]);
    const [statistics, setStatistics] = useState({});
    const [input, setInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [claudeSessionId, setClaudeSessionId] = useState(null);
    const [containerStatus, setContainerStatus] = useState('initializing'); // 'initializing', 'booting', 'ready', 'error'
    const [bootingLogs, setBootingLogs] = useState([]);
    const [errorDetails, setErrorDetails] = useState(null);
    const ws = useRef(null);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => {
        connectWebSocket();
        return () => {
            if (ws.current) {
                ws.current.close();
            }
        };
    }, [sessionId]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const connectWebSocket = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Use the same host and port as the current page
        const host = window.location.host; // This includes hostname and port
        const wsUrl = `${protocol}//${host}/ws`;
        
        ws.current = new WebSocket(wsUrl);

        ws.current.onopen = () => {
            console.log('WebSocket connected');
            ws.current.send(JSON.stringify({
                type: 'connect',
                sessionId: sessionId
            }));
        };

        ws.current.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
            }
        };

        ws.current.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        ws.current.onclose = () => {
            console.log('WebSocket disconnected');
            setTimeout(() => connectWebSocket(), 3000);
        };
    };

    const handleWebSocketMessage = (data) => {
        switch (data.type) {
            case 'containerBooting':
                setContainerStatus('booting');
                setBootingLogs(prev => [...prev, data.log || 'Starting container...']);
                break;
                
            case 'containerReady':
                setContainerStatus('ready');
                setBootingLogs([]);
                setErrorDetails(null);
                break;
                
            case 'containerError':
                setContainerStatus('error');
                setErrorDetails({
                    message: data.error,
                    logs: data.logs || bootingLogs
                });
                break;

            case 'claudeMessage':
                setMessages(prev => [...prev, {
                    id: Date.now(),
                    role: data.message.role || 'assistant',
                    content: data.message.content,
                    timestamp: new Date()
                }]);
                break;

            case 'claudeStatistics':
                setStatistics(data.statistics);
                break;

            case 'claudePartial':
                // Handle partial messages for streaming
                setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage && lastMessage.role === 'assistant' && lastMessage.partial) {
                        lastMessage.content = data.content;
                    } else {
                        newMessages.push({
                            id: Date.now(),
                            role: 'assistant',
                            content: data.content,
                            partial: true,
                            timestamp: new Date()
                        });
                    }
                    return newMessages;
                });
                break;

            case 'claudeSessionId':
                setClaudeSessionId(data.sessionId);
                break;

            case 'claudeComplete':
                setIsProcessing(false);
                // Mark last message as complete
                setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage && lastMessage.partial) {
                        lastMessage.partial = false;
                    }
                    return newMessages;
                });
                break;

            case 'sessionConnected':
                setContainerStatus('ready');
                if (data.claudeSessionId) {
                    setClaudeSessionId(data.claudeSessionId);
                }
                break;

            case 'error':
                console.error('Claude error:', data.error);
                setIsProcessing(false);
                if (data.error.includes('container') || data.error.includes('Docker')) {
                    setContainerStatus('error');
                    setErrorDetails({
                        message: data.error,
                        logs: bootingLogs
                    });
                } else {
                    setMessages(prev => [...prev, {
                        id: Date.now(),
                        role: 'system',
                        content: `Error: ${data.error}`,
                        timestamp: new Date()
                    }]);
                }
                break;
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!input.trim() || isProcessing) return;

        const userMessage = {
            id: Date.now(),
            role: 'user',
            content: input,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsProcessing(true);

        // Send message through WebSocket
        ws.current.send(JSON.stringify({
            type: 'executeCommand',
            sessionId: sessionId,
            prompt: input,
            claudeSessionId: claudeSessionId
        }));
    };

    const handleFileDownload = (content, filename) => {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        saveAs(blob, filename);
    };

    const renderMessage = (message) => {
        if (message.role === 'user') {
            return (
                <div className="message user-message">
                    <div className="message-header">User</div>
                    <div className="message-content">{message.content}</div>
                </div>
            );
        }

        if (message.role === 'system') {
            return (
                <div className="message system-message">
                    <div className="message-header">System</div>
                    <div className="message-content">{message.content}</div>
                </div>
            );
        }

        // Assistant message with markdown support
        return (
            <div className="message assistant-message">
                <div className="message-header">Claude</div>
                <div className="message-content">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            // Custom code block rendering
                            code({ node, inline, className, children, ...props }) {
                                const match = /language-(\w+)/.exec(className || '');
                                const language = match ? match[1] : '';
                                const codeContent = String(children).replace(/\n$/, '');

                                if (!inline && language) {
                                    return (
                                        <div className="code-block">
                                            <div className="code-header">
                                                <span className="code-language">{language}</span>
                                                <button
                                                    onClick={() => navigator.clipboard.writeText(codeContent)}
                                                    className="copy-button"
                                                >
                                                    Copy
                                                </button>
                                                {language && codeContent.length > 100 && (
                                                    <button
                                                        onClick={() => handleFileDownload(codeContent, `code.${language}`)}
                                                        className="download-button"
                                                    >
                                                        Download
                                                    </button>
                                                )}
                                            </div>
                                            <pre className="code-content">
                                                <code className={className} {...props}>
                                                    {children}
                                                </code>
                                            </pre>
                                        </div>
                                    );
                                }

                                return (
                                    <code className={className} {...props}>
                                        {children}
                                    </code>
                                );
                            },
                            // Table rendering
                            table({ children }) {
                                return (
                                    <div className="table-wrapper">
                                        <table className="markdown-table">{children}</table>
                                    </div>
                                );
                            },
                            // Image handling with download
                            img({ src, alt }) {
                                return (
                                    <div className="image-wrapper">
                                        <img src={src} alt={alt} className="markdown-image" />
                                        <div className="image-actions">
                                            <button
                                                onClick={() => window.open(src, '_blank')}
                                                className="view-button"
                                            >
                                                View Full Size
                                            </button>
                                            <button
                                                onClick={() => {
                                                    fetch(src)
                                                        .then(res => res.blob())
                                                        .then(blob => {
                                                            const filename = src.split('/').pop() || 'image.png';
                                                            saveAs(blob, filename);
                                                        });
                                                }}
                                                className="download-button"
                                            >
                                                Download
                                            </button>
                                        </div>
                                    </div>
                                );
                            }
                        }}
                    >
                        {message.content}
                    </ReactMarkdown>
                    {message.partial && <span className="typing-indicator">...</span>}
                </div>
            </div>
        );
    };

    // Show booting screen if container is initializing or booting
    if (containerStatus === 'initializing' || containerStatus === 'booting') {
        return (
            <div className="claude-terminal">
                <div className="terminal-header">
                    <h3>Claude Session: {sessionName}</h3>
                </div>
                
                <div className="booting-screen">
                    <div className="booting-animation">
                        <div className="spinner"></div>
                        <h2>Starting Docker Container</h2>
                        <p>Initializing Claude environment...</p>
                    </div>
                    
                    {bootingLogs.length > 0 && (
                        <div className="booting-logs">
                            {bootingLogs.map((log, index) => (
                                <div key={index} className="boot-log-line">
                                    <span className="log-indicator">▸</span> {log}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Show error screen if container failed to start
    if (containerStatus === 'error' && errorDetails) {
        return (
            <div className="claude-terminal">
                <div className="terminal-header">
                    <h3>Claude Session: {sessionName}</h3>
                </div>
                
                <div className="error-screen">
                    <div className="error-card">
                        <div className="error-header">
                            <span className="error-icon">⚠️</span>
                            <h2>Container Failed to Start</h2>
                        </div>
                        
                        <div className="error-message">
                            <p>{errorDetails.message}</p>
                        </div>
                        
                        {errorDetails.logs && errorDetails.logs.length > 0 && (
                            <div className="error-logs">
                                <h3>Container Logs:</h3>
                                <pre className="log-output">
                                    {errorDetails.logs.join('\n')}
                                </pre>
                            </div>
                        )}
                        
                        <div className="error-actions">
                            <button 
                                onClick={() => window.location.reload()} 
                                className="retry-button"
                            >
                                Retry Session
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="claude-terminal">
            <div className="terminal-header">
                <h3>Claude Session: {sessionName}</h3>
                {claudeSessionId && (
                    <span className="session-id">Session ID: {claudeSessionId}</span>
                )}
            </div>

            <div className="messages-container">
                {messages.map(message => (
                    <div key={message.id}>
                        {renderMessage(message)}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            <div className="input-section">
                <form onSubmit={handleSubmit} className="input-form">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSubmit(e);
                            }
                        }}
                        placeholder="Ask Claude anything..."
                        className="terminal-input"
                        disabled={isProcessing}
                        rows={3}
                    />
                    <button
                        type="submit"
                        disabled={isProcessing || !input.trim()}
                        className="send-button"
                    >
                        {isProcessing ? 'Processing...' : 'Send'}
                    </button>
                </form>

                {Object.keys(statistics).length > 0 && (
                    <div className="statistics-bar">
                        {statistics.model && (
                            <span className="stat-item">Model: {statistics.model}</span>
                        )}
                        {statistics.tokensUsed && (
                            <span className="stat-item">Tokens: {statistics.tokensUsed}</span>
                        )}
                        {statistics.contextUsage && (
                            <span className="stat-item">Context: {statistics.contextUsage}%</span>
                        )}
                        {statistics.responseTime && (
                            <span className="stat-item">Response: {statistics.responseTime}ms</span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ClaudeTerminal;